// AUTO -- an open-world Seattle you can drive around.

import * as THREE from './three.js';
import * as G from './geo.js';
import { cityGenerator, cityStats } from './citygen.js';
import { loadMapData } from './mapdata.js';
import { buildTextures, planTextures, encodeTextures, restoreTextures, canvasToBlob, blobToCanvas, within } from './textures.js';
import { World, WET_FLOOR } from './world.js';
import { buildLandmarks, updateLandmarkRange, SEAPLANE_DOCK, airportSurface } from './landmarks.js';
import { ShadowCache } from './shadowcache.js';
import { Monorail } from './monorail.js';
import { freezeStatic, Builder } from './build.js';
import { Fishing } from './fishing.js';
import { BONES } from './peds.js';
import { cacheGet, cachePut, cacheGuardTripped, cacheGuardSet, cacheClear } from './bootcache.js';
import { TrafficSystem, collideWithBuildings } from './traffic.js';
import { TYPES as VEHICLE_TYPES, setWaterQuery, setVehicleCache, vehicleSnapshot, vehicleAssets, paintMaterial } from './vehicles.js';

// Aircraft come in their own colours, parked at Boeing Field or delivered.
const AIRCRAFT_PAINT = {
  plane: 0xdfe3e6, sportplane: 0xc8452e, floatplane: 0xe8c53a,
  twin: 0xeceef0, jet: 0xe6e8eb, biplane: 0x2a4f93, heli: 0x223f7c,
};
import { PedSystem, animateWalk, warmLooks } from './peds.js';
import { Player } from './player.js';
import { Controls } from './controls.js';
import { Hud, buildMapCanvas } from './hud.js';
import { Activities } from './activities.js';
import { installRamps, buildRampMesh, StuntJumps } from './stunts.js';
import { Effects } from './effects.js';
import { Audio, STATION_NAMES } from './audio.js';
import { PostFX } from './postfx.js';
import { clamp, lerp, rng, dist2, formatMoney } from './util.js';

const app = document.getElementById('app');
const loadBar = document.getElementById('loadBar');
const loadMsg = document.getElementById('loadMsg');
const loading = document.getElementById('loading');
// index.html's boot log (a no-op if it is missing)
const blog = (m) => { try { if (window.__bootLog) window.__bootLog(m); } catch (e) { /* log only */ } };

// One definition of "is this a phone", used by the light rig, the starting
// quality tier and the pixel-ratio cap. Three separate copies of this test had
// already started to drift.
const ON_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const STAR_POINTS = [0, 30, 90, 190, 340, 560];
// Where the quads are parked: [x, z, heading, colour]. On measured open
// grass -- in a park, off every road, clear of footprints, lots and trunks --
// at the foot of Gas Works' Kite Hill, facing up it, and on Seattle Center's
// lawn a short walk from the spawn; and one in the seaplane dock's car park.
const ATV_SPOTS = [
  [185, -3772, -Math.PI / 2, 0x3d7a2e],
  [-172, -1947, -1.9, 0xc8452e],
  // the middle of the lawn south of the Armory, 36 m from anything in every
  // direction (it was against the Armory's wall, behind a tree)
  [-894, -940, 1.0, 0xe8b21c],
  // Jefferson Park, beside the balloon's launch field on the reservoir lid
  [2045, 4600, 0.6, 0x2e6fd0],
];
// THE HOT AIR BALLOON, on the lawn over Jefferson Park's reservoir lid on
// Beacon Hill: dead flat (98.7 m), open for 80 m every way, and one of the
// best views of the city. It stands inflated, waiting; the launch field is
// kept clear of the park's trees. See updateBalloon in vehicles.js.
const BALLOON_SITE = { x: 2089, z: 4640, heading: Math.PI };
// FISHING: a rod on a stand at the far end of a few real piers and floats.
// Each site is snapped at boot to the outermost walkable point of the deck
// nearest it, facing the open water (fishingSpots). ENTER there casts, and a
// retro fishing game opens (fishing.js).
const FISHING_SITES = [
  { name: 'Pier 66', x: -788, z: 92 },
  { name: 'Pier 59', x: -415, z: 398 },
  { name: 'Elliott Bay Marina', x: -4263, z: -2141 },
  { name: 'Leschi Marina', x: 3942, z: 1205 },
];
let fishing = null, fishSpots = [];
const HOSPITAL = G.RESPAWN; // kept clear of buildings by citygen, via G.KEEP_CLEAR

class Game {
  constructor() {
    this.wanted = 0;
    this.points = 0;
    this.money = 250;
    this.target = null;
    this.deliveryValue = 0;
    this.cool = 0;
    this.dead = false;
    this.deathT = 0;
    this.paused = false;
    this.mapOpen = false;
    this.sirenLevel = 0;
    this.settings = {
      shadows: true,
      quality: 'auto',
      music: true,
      sound: true,
      sensitivity: 1,
      debug: false,
      post: true,
    };
  }

  addHeat(n) {
    if (this.dead) return;
    const before = this.wanted;
    this.points += n;
    this.cool = 0;
    let stars = 0;
    for (let i = 1; i < STAR_POINTS.length; i++) if (this.points >= STAR_POINTS[i]) stars = i;
    this.wanted = Math.min(5, stars);
    if (this.wanted > before) {
      audio.wanted(this.wanted);
      hud.showToast(this.wanted === 1 ? 'WANTED' : `WANTED ${'★'.repeat(this.wanted)}`);
    }
  }

  // --- callbacks used by the simulation ------------------------------------

  onCrash(impact, isPolice) {
    audio.crash(impact);
    const p = player.position;
    fx.sparks(p.x, p.y + 0.8, p.z, Math.min(14, Math.round(impact)));
    if (isPolice) this.addHeat(18);
    else if (impact > 12) this.addHeat(3);
  }

  // A crash between two AI cars, heard where it happened.
  onTrafficCrash(impact, x, z) {
    audio.crash(impact, x, z);
  }

  onPedHit(byPlayer, ped) {
    audio.pedHit();
    fx.blood(ped.x, ped.y + 1, ped.z);
    peds.scare(ped.x, ped.z, 30);
    if (byPlayer) this.addHeat(22);
  }

  onPedKilled(ped, isPlayer) {
    fx.blood(ped.x, ped.y + 1.1, ped.z);
    peds.scare(ped.x, ped.z, 40);
    if (isPlayer) this.addHeat(ped.cop ? 60 : 30);
  }

  onCopShot(cop) {
    audio.gunshot(cop.x, cop.z);
    const p = player.position;
    fx.tracer(cop.x, cop.y + 1.35, cop.z, p.x, p.y + 1.2, p.z);
    fx.sparks(cop.x + Math.sin(cop.heading), cop.y + 1.35, cop.z + Math.cos(cop.heading), 3);
    if (Math.random() < 0.55) this.damagePlayer(6 + Math.random() * 6, 'gun');
  }

  onGunshot(x, y, z, dir) {
    audio.gunshot();
    fx.tracer(x, y, z, x + dir.x * 55, y - 1.5, z + dir.z * 55);
    fx.sparks(x + dir.x * 0.7, y, z + dir.z * 0.7, 4);
    peds.scare(x, z, 45);
    this.addHeat(10);
  }

  onShotVehicle(v, x, z) {
    fx.sparks(x, v.y + 0.9, z, 5);
    if (v.dead) this.onCarDestroyed(v);
  }

  onPunch() {
    audio.punch();
  }

  onHorn() {
    audio.horn();
    peds.scare(player.position.x, player.position.z, 14);
  }

  onEnterVehicle(v, wasMode) {
    controls.setMode('drive');
    if (v.spec.monorail) {
      audio.enterVehicle(v.spec, false);
      for (const [k, t] of [['gas', 'POWER'], ['brake', 'BRAKE']]) {
        const el = document.querySelector(`[data-btn="${k}"]`);
        if (el) el.textContent = t;
      }
      monorail.onBoard(v);
      return;
    }
    // A car taken from traffic already has its engine running; a parked one,
    // an apron plane or one you left earlier has to be started.
    audio.enterVehicle(v.spec, wasMode === 'traffic' || wasMode === 'police');
    // In a helicopter GAS and BRAKE are the collective.
    const heli = !!v.spec.heli, balloon = !!v.spec.balloon;
    for (const [k, car, h, b] of [['gas', 'GAS', 'UP', 'BURN'], ['brake', 'BRAKE', 'DOWN', 'VENT']]) {
      const el = document.querySelector(`[data-btn="${k}"]`);
      if (el) el.textContent = balloon ? b : heli ? h : car;
    }
    if (heli) setTimeout(() => hud.showToast('Hold UP to lift off — let go to hover'), 1400);
    if (balloon) {
      setTimeout(() => hud.showToast('Hold BURN to heat the envelope and rise — VENT to sink'), 1200);
      setTimeout(() => hud.showToast('The wind turns with height: climb or sink to change course'), 6500);
    }
    if (v.mode === 'parked' || v.wasParked) this.addHeat(8);
    hud.showToast(v.typeName === 'police' ? 'Police cruiser commandeered' : 'Vehicle acquired');
    // The radio comes on with the ignition, on a random station (every car
    // its own, as in GTA); RADIO on the pad tunes the next one. audio.update()
    // starts the stream on the next frame; this is only the announcement.
    if (this.settings.music && audio.musicOn) {
      audio.randomStation();
      setTimeout(() => hud.showToast(`♪ ${audio.stationName()}`), 900);
    }
  }

  // a wheelie held over 2 s (vehicles.js), announced the way GTA does
  onWheelie(t) { hud.showToast(`Wheelie ${t.toFixed(1)} s`); }

  /** ENTER on foot, before the cars: a fishing rod within reach? */
  tryInteract(pl) {
    if (!fishing || fishing.active) return false;
    for (const sp of fishSpots) {
      if (Math.hypot(pl.x - sp.rx, pl.z - sp.rz) < 3.2 && Math.abs(pl.y - sp.y) < 2) {
        this.paused = true;
        const b = player.h.bones;
        fishing.start(sp, { scene, camera, player, audio,
          bones: { handR: b[BONES.handR], shoulderR: b[BONES.shoulderR], elbowR: b[BONES.elbowR], shoulderL: b[BONES.shoulderL], elbowL: b[BONES.elbowL] } });
        if (sp.prop) sp.prop.userData.rod.visible = false;
        return true;
      }
    }
    return false;
  }

  onExitVehicle(v) {
    controls.setMode('foot');
    if (v) audio.exitVehicle(v.spec, v.dead);
    if (v && v.spec.monorail) monorail.onLeave(v);
  }

  /** ENTER with nothing to get into: near a monorail station, say when the next train is in. */
  onMonorailWait(x, y, z) {
    const near = (p, r) => p && Math.hypot(x - p.x, z - p.z) < r;
    const st = near(monorail.wlDoor, 12) ? 'wl' : near(monorail.scStation, 45) && Math.abs(y - monorail.scFloor) < 2 ? 'sc' : null;
    if (!st) return;
    const eta = monorail.nextAt(st);
    hud.showToast(eta === null ? 'The next train leaves the other end shortly — wait at the platform'
      : eta < 5 ? 'The train is pulling in — wait for the doors' : `Next train in about ${Math.ceil(eta / 10) * 10} s`);
  }

  onLand(drop) {
    audio.land(drop);
  }

  /** A boat refused to let you step off into the lake (player.exitVehicle). */
  onNoLanding(v) {
    if (v && v.spec.monorail) { hud.showToast('The doors only open at a platform — stop at Westlake Center or Seattle Center'); return; }
    hud.showToast('Nowhere to step off — bring it alongside a dock or the shore');
  }

  onDrown() {
    this.damagePlayer(200, 'water');
  }

  onCarSank(v) {
    this.damagePlayer(200, 'water');
  }

  onCarDestroyed(v) {
    if (v.exploded) return;
    v.exploded = true;
    fx.explosion(v.x, v.y + 1, v.z);
    audio.explosion(v.x, v.z);
    peds.scare(v.x, v.z, 45);
    if (v === player.vehicle) {
      this.damagePlayer(70, 'explosion');
      player.exitVehicle(true);
    }
    this.addHeat(14);
    setTimeout(() => traffic.remove(v), 60);
  }

  damagePlayer(n, cause) {
    if (this.dead) return;
    player.health -= n;
    document.getElementById('hurt').classList.add('flash');
    setTimeout(() => document.getElementById('hurt').classList.remove('flash'), 160);
    if (player.health <= 0) {
      player.health = 0;
      this.dead = true;
      this.deathT = 0;
      document.getElementById('wasted').classList.add('show');
    }
  }

  // --- deliveries -----------------------------------------------------------

  newTarget() {
    const city = cityRef;
    for (let i = 0; i < 60; i++) {
      const ni = Math.floor(Math.random() * city.nodes.length);
      const n = city.nodes[ni];
      if (n.elev) continue;
      const p = player.position;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < 420 || d > 2400) continue;
      this.target = { x: n.x, z: n.z, y: city.groundAt(n.x, n.z, null) };
      this.deliveryValue = Math.round(120 + d * 0.28);
      hud.setObjective(`Deliver to ${G.placeNameAt(n.x, n.z)} — ${formatMoney(this.deliveryValue)}`);
      marker.position.set(n.x, this.target.y, n.z);
      marker.visible = true;
      return;
    }
  }

  checkTarget() {
    if (!this.target) return;
    const p = player.position;
    if (dist2(p.x, p.z, this.target.x, this.target.z) < 13 * 13) {
      this.money += this.deliveryValue;
      audio.cash();
      hud.showToast(`Delivered — ${formatMoney(this.deliveryValue)}`);
      this.newTarget();
    }
  }
}

// ---------------------------------------------------------------------------

let renderer, scene, camera, sun, world, cityRef, traffic, peds, player, controls, hud, fx, audio, game, marker, postfx, acts, stunts, monorail, lmRoot, shadowCache = null;
let pickups = [];
// Scratch vector for the shadow-camera aim, so the frame loop allocates none.
const LOOK_AHEAD = new THREE.Vector3();

// The sun's offset from the point it lights: ~38 deg elevation, fixed azimuth.
const SUN_OFFSET = new THREE.Vector3(-215, 200, -150);
// The shadow camera's own axes. It looks along -SUN_OFFSET with world up, so
// these are exactly the basis three's lookAt builds for it every frame.
const SUN_R = new THREE.Vector3(), SUN_U = new THREE.Vector3(), SUN_F = new THREE.Vector3();
{
  const m = new THREE.Matrix4().lookAt(SUN_OFFSET, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  SUN_R.setFromMatrixColumn(m, 0);
  SUN_U.setFromMatrixColumn(m, 1);
  SUN_F.setFromMatrixColumn(m, 2);
}
let shadowTexelM = 0.25;

/**
 * Follow the player with the shadow box, in whole shadow texels.
 *
 * The box used to be re-centred on the player every frame by whatever
 * fraction of a texel they had moved, so the shadow map was rasterised at a
 * different sub-texel phase each frame and every shadow edge in the city
 * crawled and shimmered as you walked or drove -- the classic moving-shadow
 * flicker, and it reads as "the whole picture is janky" rather than as a
 * shadow problem. Snapping the centre to the texel grid in the LIGHT's own
 * frame means a move re-draws the same map shifted by whole texels, and the
 * shaded result is identical. Measured with the camera still and the centre
 * stepped 5 cm at a time: 2.18 % of pixels changed per step on a commercial
 * street before, 0.68 % on a residential one.
 *
 * Aiming the box down the view is unchanged: centred on the player, half of it
 * covers ground behind the camera, so the centre is pushed 90 m ahead.
 */
function placeSun(px, py, pz) {
  const fwd = LOOK_AHEAD.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const cx = px + fwd.x * 90, cy = py, cz = pz + fwd.z * 90;
  const T = shadowTexelM;
  const a = Math.round((cx * SUN_R.x + cy * SUN_R.y + cz * SUN_R.z) / T) * T;
  const b = Math.round((cx * SUN_U.x + cy * SUN_U.y + cz * SUN_U.z) / T) * T;
  // Depth along the light too: it does not move texels, but it moves every
  // stored depth by a fraction and the PCF compare can flip on a grazing roof.
  const d = Math.round((cx * SUN_F.x + cy * SUN_F.y + cz * SUN_F.z) / T) * T;
  const sx = SUN_R.x * a + SUN_U.x * b + SUN_F.x * d;
  const sy = SUN_R.y * a + SUN_U.y * b + SUN_F.y * d;
  const sz = SUN_R.z * a + SUN_U.z * b + SUN_F.z * d;
  sun.target.position.set(sx, sy, sz);
  sun.position.set(sx + SUN_OFFSET.x, sy + SUN_OFFSET.y, sz + SUN_OFFSET.z);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
}
let last = 0;
let accumFps = 0, frames = 0, fps = 60;
let baseFogDensity = 0.00026;
let startedAt = 0;

async function boot() {
  const step = async (p, msg) => {
    loadBar.style.width = `${Math.round(p * 100)}%`;
    loadMsg.textContent = msg;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  await step(0.02, 'Painting the city');
  // WHAT AN EARLIER LAUNCH OF THIS BUILD LEFT (bootcache.js): everything below
  // that is deterministic in the data and the code and slow on a phone.
  // Each piece falls back to computing on its own, and whatever was computed
  // is kept at the end of the boot for the next launch.
  const BC_KEYS = ['textures', 'map', 'buildings', 'grade', 'portal', 'vehicles'];
  const bc = {};
  blog('main started, ' + (navigator.userAgent.match(/OS [\d_]+|Chrome\/\d+|Version\/[\d.]+/g) || []).join(' '));
  if (cacheGuardTripped()) {
    // the last launch from the cache never reached a frame: start clean
    blog('cache: last cached launch never finished -- clearing it');
    await cacheClear();
  } else {
    const t0 = performance.now();
    (await Promise.all(BC_KEYS.map((k) => cacheGet(k)))).forEach((v, i) => { bc[BC_KEYS[i]] = v; });
    blog(`cache read ${((performance.now() - t0) / 1000).toFixed(1)}s: ` + BC_KEYS.map((k) => k + (bc[k] ? '+' : '-')).join(' '));
  }
  if (Object.values(bc).some(Boolean)) cacheGuardSet(true);
  const bcOut = {};
  let tx = null;
  if (bc.textures) {
    const t0 = performance.now();
    try { tx = await within(restoreTextures(bc.textures), 12000); } catch (e) { tx = null; blog('textures: restore failed ' + e.message); }
    blog(tx ? `textures restored ${((performance.now() - t0) / 1000).toFixed(1)}s` : 'textures: restore gave up, painting');
  }
  if (!tx) { tx = buildTextures(); bcOut.texPlan = planTextures(tx); }
  if (bc.vehicles) setVehicleCache(bc.vehicles);

  // The map is real data now -- USGS elevation and OpenStreetMap -- so the hills
  // and the street grid are downloaded rather than generated. About 3.8 MB, and
  // the service worker keeps it in the same lazy tier as the Three.js build.
  await step(0.06, 'Downloading Seattle');
  let mdMsg = 'Downloading Seattle';
  const md = await loadMapData((m) => { mdMsg = m; loadMsg.textContent = m; });
  loadMsg.textContent = mdMsg;
  G.initGeo(md);

  await step(0.18, 'Laying out the streets');
  // The freeway grading of this build, if an earlier launch kept it (see
  // bootcache.js): the biggest single step of a phone's boot.
  const bootCache = { grade: bc.grade, buildings: bc.buildings };
  // The monorail from its data alone: citygen keeps buildings off its line.
  monorail = new Monorail(md.monorail);
  md.monorailClear = monorail.clearZones();
  const gen = cityGenerator(md, bootCache);
  let r = gen.next();
  while (!r.done) {
    loadBar.style.width = `${Math.round((0.18 + r.value.p * 0.44) * 100)}%`;
    loadMsg.textContent = r.value.msg;
    await new Promise((res) => requestAnimationFrame(res));
    r = gen.next();
  }
  const city = r.value;
  cityRef = city;
  blog(`city: grading ${cityStats.gradeCached ? 'from cache' : 'computed'}, buildings ${bootCache.buildings ? 'from cache' : 'computed'}`);

  await step(0.64, 'Raising the terrain');

  // --- renderer ---
  const canvas = document.getElementById('gl');
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  // Antialiasing comes from FXAA in the post chain, so the context never needs
  // MSAA -- which also means the scene can render into a target for free.
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 1.6));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // EXPOSURE, not ambient, is the lever on a scene sitting in the ACES toe.
  //
  // The city floor was at 0.02-0.04 scene-referred, which is exactly where the
  // ACES curve compresses hardest, so light added at the source was eaten
  // before it reached the framebuffer: hemisphere and ambient were pushed 2.6x
  // and bought 1.6x on screen. Exposure slides the whole scene up the curve
  // instead of pushing harder into the compressed region.
  renderer.toneMappingExposure = 0.53;
  const viewW = () => canvas.clientWidth || window.innerWidth;
  const viewH = () => canvas.clientHeight || window.innerHeight;
  renderer.setSize(viewW(), viewH(), false);
  renderer.shadowMap.enabled = true;
  // PCFSoft is the most expensive filter three offers and it is a fill-rate
  // cost paid on every shadowed pixel. On a phone that is not where the budget
  // should go; plain PCF is a fraction of the cost and the difference at this
  // resolution is a slightly harder shadow edge.
  renderer.shadowMap.type = ON_PHONE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

/**
 * Height falloff on the exponential fog.
 *
 * FogExp2 is uniform in every direction, so haze that reads correctly along a
 * street also fills the sky at the top of a tower: a 180 m building three
 * kilometres out dissolves at its crown exactly as much as at its base, and
 * the downtown silhouette flattens into one grey wash. Real aerial haze sits
 * in the lower atmosphere, which is why distant towers punch out of it.
 *
 * Patched into three's fog shader chunks rather than done with a custom
 * material, because it has to apply to every lit surface in the scene --
 * terrain, roads, buildings, water, vehicles, characters -- and those are a
 * dozen different materials. `transformed` is the final local position by the
 * time <fog_vertex> is included (skinning and morphs have already run), so
 * skinned pedestrians fog from where they actually stand.
 *
 * This is per-fragment height rather than a true integral along the view ray.
 * The integral is the physically right answer and costs an exp and a divide
 * per pixel; at the scale of the error over a 16 km map it is not visible.
 */
function installHeightFog() {
  const C = THREE.ShaderChunk;
  if (C.__heightFog) return;
  C.__heightFog = true;
  C.fog_pars_vertex = `${C.fog_pars_vertex}\n#ifdef USE_FOG\n  varying float vFogWorldY;\n#endif`;
  C.fog_vertex = `${C.fog_vertex}\n#ifdef USE_FOG\n  vFogWorldY = (modelMatrix * vec4(transformed, 1.0)).y;\n#endif`;
  C.fog_pars_fragment = `${C.fog_pars_fragment}\n#ifdef USE_FOG\n  varying float vFogWorldY;\n#endif`;
  // Scale the density by the fragment's height above sea level. At a scale
  // height of 130 m a street is fully hazed and a 200 m crown keeps about a
  // fifth of the density, which is the separation the skyline needs.
  //
  // The scale height is a shader constant, not a uniform. ShaderLib.physical
  // COPIES UniformsLib.fog when three's module is evaluated, so a key added to
  // UniformsLib afterwards never reaches the program and the shader compiles
  // against an undeclared name.
  C.fog_fragment = C.fog_fragment.replace(
    'float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
    'float heightScale = exp( - max( vFogWorldY, 0.0 ) / 130.0 );\n'
    + '\tfloat hDensity = fogDensity * heightScale;\n'
    + '\tfloat fogFactor = 1.0 - exp( - hDensity * hDensity * vFogDepth * vFogDepth );'
  );
}

/**
 * Fade shadowing out across the last few percent of the shadow box.
 *
 * Where the ortho box ends, three simply stops testing and returns "lit", so
 * the boundary is a hard line: a block's shadow a couple of hundred metres
 * ahead is cut square, and because the box follows the view that line slides
 * across the street as you turn -- a whole band of the frame flicking from
 * shaded to lit. Fading the last 7 % of the box (~36 m at 260 m half-width)
 * turns the cut into a gradient nobody tracks. One smoothstep per shadowed
 * fragment, inside the existing branch.
 */
function installShadowFade() {
  const C = THREE.ShaderChunk;
  if (C.__shadowFade) return;
  C.__shadowFade = true;
  const from = '#endif\n\t\t}\n\t\treturn shadow;\n\t}\n\tvec2 cubeToUV';
  if (!C.shadowmap_pars_fragment.includes(from)) {
    console.warn('shadow fade: three chunk changed, not patched');
    return;
  }
  C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replace(from,
    '#endif\n'
    + '\t\t\tvec2 shadowEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );\n'
    + '\t\t\tshadow = mix( 1.0, shadow, smoothstep( 0.0, 0.07, min( shadowEdge.x, shadowEdge.y ) ) );\n'
    + '\t\t}\n\t\treturn shadow;\n\t}\n\tvec2 cubeToUV');
}

  scene = new THREE.Scene();
  // Aerial perspective. At 0.00032 a tower 3 km away reads at nearly the same
  // contrast and saturation as one across the street, which is what made the
  // city look like a diorama. The colour is matched to the sky near the
  // horizon so distance resolves INTO the sky rather than toward a grey haze
  // sitting in front of it.
  // 0.00060 overshot: it dissolved the downtown silhouette into the sky rather
  // than giving it depth. Aerial perspective should separate planes, not erase
  // them, and the fog is tinted slightly cooler than the horizon so towers
  // still read against it.
  scene.fog = new THREE.FogExp2(0xb9c3cf, 0.00026);
  baseFogDensity = scene.fog.density;
  installHeightFog();
  camera = new THREE.PerspectiveCamera(62, viewW() / viewH(), 0.5, 9000);

  // The sky IBL supplies most of the ambient, so the analytic lights are just a
  // key with a cool bounce fill.
  // KEY-TO-AMBIENT IS THE WHOLE LOOK. At hemi 2.0 against sun 2.5, plus full
  // IBL on top, the ambient dominated and the ratio was about 1.3:1 -- so two
  // faces of the same building differed only by texture, never by light. Nothing
  // downstream can read under a shadowless sky: AO, normal maps and geometry all
  // score flat no matter how good they are. Daylight open-worlds run nearer 4:1,
  // warm key against cool sky fill.
  const hemi = new THREE.HemisphereLight(0xdcecf6, 0x8d968a, 0.72);
  scene.add(hemi);
  // A floor under the shadows.
  //
  // Measured on the composited frame -- which is the only honest place to
  // measure it, since the post chain is part of the value structure -- the
  // aerial city ran a lit-to-shadow ratio of 13.8:1, with the shadowed quarter
  // sitting at 0.004 linear under a 0.43 sky. That is a night value and a
  // daylight sky in the same picture. Console open worlds of this era ran
  // roughly 2.2-3.3:1, because a shadowed surface outdoors still sees most of
  // the sky dome plus bounce off everything around it.
  //
  // Four passes were spent lifting albedos against this, which is the wrong
  // lever: no base colour survives being multiplied by an ambient term near
  // zero. Raising the floor fixes the aerial value inversion, the near-black
  // street asphalt and the black tower bodies at once, and it lets the roof
  // albedo go back where it belongs.
  scene.add(new THREE.AmbientLight(0xb4c2cc, 0.36));
  sun = new THREE.DirectionalLight(0xfff2dc, 4.3);
  // ~38 deg elevation: high enough to light the streets, low enough that every
  // shot has a lit face and a shadowed one.
  sun.position.set(-215, 200, -150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(ON_PHONE ? 1024 : 2048, ON_PHONE ? 1024 : 2048);
  sun.shadow.camera.near = 20;
  // 1150 was set to stop tall casters falling out of the frustum at the box
  // edge. That is still the reason, but the far plane costs geometry in the
  // shadow pass every frame, and the pass measured 152 draw calls and 318k
  // triangles -- a third of the whole frame.
  sun.shadow.camera.far = 980;
  // 105 m covered barely a block: buildings cast no shadow on the streets they
  // line, which is most of why the city read as flat. 190 m reaches across a
  // downtown block and its far side at the cost of shadow-map resolution,
  // which 2048 absorbs.
  //
  // 190 was still not enough, and the way it failed was mistaken three times
  // for a material bug. Where the ortho box ends, shadowing simply stops, so a
  // tower's shadow on the block behind it was cut off mid-facade in a straight
  // vertical line with no bottom to it -- a black band with a hard edge and no
  // caster you could point at, which is not a shape any real shadow has. The
  // giveaway is that widening the box turns previously LIT pixels dark: a real
  // shadow does not gain area when you enlarge the camera that renders it.
  //
  // 260 m at 2048 is 0.25 m per texel, which is inside the range this era of
  // console shadow ran at. `far` goes up with it, or tall casters fall out of
  // the frustum at the same edge for the same reason.
  const S = ON_PHONE ? 190 : 260;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  // Bias is DERIVED from texel size, not written down.
  //
  // The rule is that normalBias has to span a shadow texel, and the texel is
  // 2*S/mapSize -- so it changes whenever either the box or the map does. That
  // coupling was noted in the docs and then promptly broken: dropping the phone
  // to a 1024 map made its texel 0.37 m against the desktop's 0.25, and the
  // bias was moved DOWN at the same time, from 0.12 to 0.09. The result is
  // classic acne, dark cloudy blotches over flat sunlit ground, and it was
  // mistaken for an SSAO artefact because it looks like one.
  //
  // Computing it removes the chance of getting it wrong again.
  const shadowTexel = (S * 2) / sun.shadow.mapSize.x;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = shadowTexel * 0.48;
  shadowTexelM = shadowTexel;
  installShadowFade();
  scene.add(sun);
  scene.add(sun.target);

  postfx = new PostFX(renderer);
  postfx.setSize(viewW(), viewH(), renderer.getPixelRatio());

  world = new World(scene, city, tx, { shadows: true, renderer, lakes: md.lakes });
  // ...and its portal cuts, barriers and lids (the terrain's carve needs them).
  // Only with a cached grading: the lids were computed on those profiles.
  world.bootCache = { portal: bootCache.grade ? bc.portal : null };
  world.buildSky(SUN_OFFSET);
  const terrGen = world.buildTerrain();
  let tr = terrGen.next();
  while (!tr.done) {
    loadBar.style.width = `${Math.round((0.64 + tr.value * 0.14) * 100)}%`;
    await new Promise((res) => requestAnimationFrame(res));
    tr = terrGen.next();
  }
  world.buildWater();
  // Stunt ramps: after the terrain (their bases read the carved ground and the
  // portal barriers they join are installed) and before any chunk streams, so
  // the scatter keeps their run-ups and landings clear.
  {
    const ramps = installRamps(city);
    const rampMesh = buildRampMesh(city, ramps, world.mats.flat);
    if (rampMesh) scene.add(rampMesh);
  }

  await step(0.8, 'Building the skyline');
  world.buildSkyline();

  await step(0.86, 'Placing the landmarks');
  monorail.attach(city);
  lmRoot = buildLandmarks(scene, city, (x, z) => world.waterLevelAt(x, z), monorail);
  // the balloon's launch field: no park trees on it
  if (city.clearCircles) city.clearCircles.push([BALLOON_SITE.x, BALLOON_SITE.z, 26]);
  // The scene root never moves, and its own matrixAutoUpdate re-flagged EVERY
  // object in the world for a world-matrix multiply each frame. Static
  // subtrees are frozen; see freezeStatic.
  scene.matrixAutoUpdate = false;
  if (lmRoot) freezeStatic(lmRoot);
  // the two trains (skinned: they pose their own bones each frame)
  monorail.makeTrains(scene);
  // Phones draw the city's shadows once and copy them each frame; only what
  // moves is drawn into the shadow map every frame (shadowcache.js). The
  // desktop keeps three's pass: its 2048 map would make the cache ~4x larger.
  if (ON_PHONE && !window.__noShadowCache) {
    try {
      const ramps = scene.getObjectByName('stuntRamps');
      shadowCache = new ShadowCache(renderer, sun, { margin: 60, statics: () => [world.group, lmRoot, ramps], keep: () => [] });
      world.onChunkChange = (x, z, r) => shadowCache.chunkChanged(x, z, r);
    } catch (e) { blog(`shadow cache: ${e.message}`); shadowCache = null; }
  }
  if (world.terrainGroup) freezeStatic(world.terrainGroup);

  await step(0.9, 'Waking the city');
  game = new Game();
  audio = new Audio();
  // KEXP's now-playing feed drives a toast, so the radio names its own tracks.
  audio.onTrack = (label) => { if (hud) hud.showToast(`♪ ${label}`); };
  controls = new Controls(document.getElementById('app'));
  player = new Player(scene, city, game, world);
  player.monorail = monorail;
  traffic = new TrafficSystem(scene, city, game);
  traffic.camera = camera;   // far-LOD instances are culled against it
  setWaterQuery((x, z) => world.waterLevelAt(x, z));
  // Boeing Field's apron: three trainers, parked nose-out along the taxiway
  // side, matching the landmark's own layout constants (bearing -0.52, apron
  // centred 260 m east, 120 m south of the ARP). Mode 'apron' so they never
  // despawn -- flying one away and driving back must find the others waiting.
  {
    const ap = (G.LANDMARKS || []).find((l) => l.kind === 'airport');
    if (ap) {
      // Everything stands on the drawn apron and runway, not the field under them.
      city.slabQuery = airportSurface(ap.x, ap.z, G.terrainHeight(ap.x, ap.z));
      // Same explicit axes as the landmark: ALONG = runway bearing 150.
      const AL = [Math.sin(0.52), Math.cos(0.52)], AC = [Math.cos(0.52), -Math.sin(0.52)];
      const off = (dx, dz) => [ap.x + dx * AC[0] + dz * AL[0], ap.z + dx * AC[1] + dz * AL[1]];
      // Three clusters, all on pavement, all reachable from the west-side
      // streets: the apron row, the north threshold turnpad, and the south.
      // The apron is not all clear: a real street with its pavements runs
      // through its west side (across -260..-230) and a hangar stands at
      // across -215..-185, along -50..-10 -- where the first trainer used to
      // be parked, half inside it. The bigger aircraft take a second row
      // toward the taxiway, and the two helicopters sit on their pads
      // (landmarks.js AIRPORT_HELIPADS) at the apron's north and south ends.
      const spots = [
        ['plane', -160, -58], ['sportplane', -195, 45], ['plane', -195, 140],
        ['twin', -150, 0], ['jet', -150, 95], ['biplane', -152, 188],
        ['heli', -165, -103], ['heli', -195, 232, 0xb8322a],
        ['sportplane', -150, -1380], ['plane', -150, -1290],
        ['floatplane', -150, 1290], ['sportplane', -150, 1380],
        // the fighter, on the runway centreline at the south threshold,
        // facing north up all 3 km of it (heading 0.52 would face south)
        ['fighter', 0, 1450, 0x7b8590, 0.52 + Math.PI],
      ];
      for (const [ty, dx, dz, col, hd] of spots) {
        const [px, pz] = off(dx, dz);
        const v = traffic.spawnAt(px, pz, hd !== undefined ? hd : 0.52, ty, col || AIRCRAFT_PAINT[ty], 'apron');
        v.vLong = 0;
      }
    }
  }
  // The seaplane dock on Lake Union (landmarks.js builds it and owns the
  // mooring list): floatplanes and boats tied up alongside its float, 'apron'
  // so they never despawn. place() puts a plane on the lakebed, so a
  // floatplane's height is set from the LOCAL surface by hand and its float
  // physics hold it there after; a boat's place() finds the surface itself.
  for (const [ty, x, z, h, col] of SEAPLANE_DOCK.moorings) {
    const v = traffic.spawnAt(x, z, h, ty, col, 'apron');
    v.vLong = 0;
    if (v.spec.floats) {
      const wl = world.waterLevelAt(x, z);
      v.y = (wl !== null ? wl : SEAPLANE_DOCK.level) + 0.12;
      v.group.position.y = v.y + (v.spec.wheelR || 0.3) + 0.25;
    }
  }
  // The marinas' boats, jet skis and floatplanes (landmarks.js MARINAS),
  // moored the way the seaplane dock's are.
  for (const mr of lmRoot.userData.marinas || []) {
    for (const [ty, x, z, h, col] of mr.moorings) {
      const v = traffic.spawnAt(x, z, h, ty, col, 'apron');
      v.vLong = 0;
      if (v.spec.floats) {
        const wl = world.waterLevelAt(x, z);
        v.y = (wl !== null ? wl : mr.level) + 0.12;
        v.group.position.y = v.y + (v.spec.wheelR || 0.3) + 0.25;
      }
    }
  }
  // Quads, parked out on the grass where they are for: Gas Works' Kite Hill,
  // the lawn by the seaplane dock, and Seattle Center's by the spawn.
  for (const [x, z, h, col] of ATV_SPOTS) {
    const v = traffic.spawnAt(x, z, h, 'atv', col, 'apron');
    v.vLong = 0;
  }
  spawnBalloon();
  fishSpots = fishingSpots();
  fishing = new Fishing({
    audio,
    onReward: (m) => { game.money += m; setTimeout(() => hud.showToast(`Fishing paid $${m}`), 400); },
    onEnd: () => {
      game.paused = false;
      for (const sp of fishSpots) if (sp.prop) sp.prop.userData.rod.visible = true;
    },
  });
  // A CAR WORTH TAKING at the kerb nearest the spawn. Kerbside cars come from
  // a fixed hash of street slots, so the first car every player walked up to
  // was the same pickup. That slot is reserved and a sports coupe parked in it
  // for good (apron: never despawned, like the quads).
  {
    traffic.updateParked(G.SPAWN.x, G.SPAWN.z);
    let best = null, bd = Infinity;
    for (const v of traffic.cars) {
      if (v.mode !== 'parked' || typeof v.slot !== 'number') continue;
      const dd = Math.hypot(v.x - G.SPAWN.x, v.z - G.SPAWN.z);
      if (dd < bd) { bd = dd; best = v; }
    }
    if (best) {
      traffic.reservedSlots.add(best.slot);
      const { x, z, heading } = best;
      traffic.remove(best);
      traffic.spawnAt(x, z, heading, 'sports', 0xc4161c, 'apron').vLong = 0;
    }
  }
  // What the map marks, and what says hello when you get near (the HUD is
  // made below; it takes the list then).
  const mapPlaces = [
    { x: SEAPLANE_DOCK.x, z: SEAPLANE_DOCK.z, kind: 'dock', name: 'Seaplane Dock', near: false,
      hello: `${SEAPLANE_DOCK.name} — floatplanes and boats. Walk out to the float and get in` },
    ...(() => {
      const ap = (G.LANDMARKS || []).find((l) => l.kind === 'airport');
      if (!ap) return [];
      const AL = [Math.sin(0.52), Math.cos(0.52)];
      return [{ x: ap.x + 1450 * AL[0], z: ap.z + 1450 * AL[1], kind: 'jet', name: 'Fighter jet', near: false,
        hello: 'A fighter jet — full throttle, pull back past 220 km/h. Hold the stick back to loop' }];
    })(),
    ...ATV_SPOTS.map(([x, z]) => ({ x, z, kind: 'atv', name: 'Quad bike', near: false, hello: 'A quad bike — made for the grass' })),
    ...fishSpots.map((sp) => ({ x: sp.x, z: sp.z, kind: 'fish', name: `Fishing — ${sp.name}`, near: false,
      hello: 'A fishing rod on the pier. Press ENTER to cast' })),
    { x: BALLOON_SITE.x, z: BALLOON_SITE.z, kind: 'balloon', name: 'Hot air balloon', near: false,
      hello: 'A hot air balloon, ready to fly. Climb into the basket' },
    // the Monorail's two stations: Westlake's street door, Seattle Center's ramp
    ...(monorail.wlDoor ? [{ x: monorail.wlDoor.x, z: monorail.wlDoor.z, kind: 'monorail', name: 'Monorail · Westlake', near: false,
      hello: 'Seattle Center Monorail — the 1962 Alweg line. Tap ENTER at the door when a train is in to take the controls' }] : []),
    ...(monorail.scRamp ? [{ x: monorail.scRamp.x, z: monorail.scRamp.z, kind: 'monorail', name: 'Monorail · Seattle Center', near: false,
      hello: 'Seattle Center Monorail — up the ramp to the platforms. Tap ENTER beside a train to take the controls' }] : []),
    ...(lmRoot.userData.marinas || []).map((mr) => ({ x: mr.x, z: mr.z, kind: 'dock', name: mr.name, near: false,
      hello: mr.seaplanes ? `${mr.name} — floatplanes on the float. Walk out and climb in`
        : `${mr.name} — boats and jet skis. Walk out on the float and take one` })),
  ];
  peds = new PedSystem(scene, city, game);
  peds.camera = camera;   // animation LOD culls against it
  fx = new Effects(scene, tx);
  let mapCanvas = null;
  if (bc.map) { try { mapCanvas = await blobToCanvas(bc.map); } catch (e) { mapCanvas = null; blog('map: restore failed ' + e.message); } }
  if (!mapCanvas) { mapCanvas = buildMapCanvas(city); bcOut.mapCanvas = mapCanvas; }
  hud = new Hud(document.getElementById('app'), city, mapCanvas);
  hud.places = mapPlaces;
  hud.monorail = monorail;
  monorail.bind({ game, hud, audio, player });
  {
    // One tap, never behind a menu: a lost run on a phone ends the session.
    const rb = document.getElementById('raceRestart');
    if (rb) rb.addEventListener('click', (ev) => { ev.stopPropagation(); if (acts) acts.restart(player); });
    // The delivery service: the money sink. Spend winnings and the vehicle
    // arrives beside you -- including aircraft, which is how you get a plane
    // without driving to Boeing Field first.
    for (const b of document.querySelectorAll('.buy')) {
      b.addEventListener('click', () => {
        const cost = +b.dataset.cost, type = b.dataset.buy;
        if (game.money < cost) { hud.showToast('Not enough money'); return; }
        game.money -= cost;
        const p = player.position;
        const f = { x: Math.sin(player.camYaw + Math.PI), z: Math.cos(player.camYaw + Math.PI) };
        const dx = p.x + f.x * 12, dz = p.z + f.z * 12;
        const v = traffic.spawnAt(dx, dz, player.camYaw + Math.PI, type, AIRCRAFT_PAINT[type] || 0xdfe3e6, 'free');
        v.y = city.groundAt(dx, dz, null);
        v.sync();
        hud.showToast(`${b.textContent.replace(/\s*\$\d+$/, '')} delivered — $${cost}`);
        if (setPausedRef) setPausedRef(false);
      });
    }
  }
  // after the HUD: Activities writes its readout and map icons through it
  acts = new Activities(scene, city, world, game, hud, audio, traffic);
  stunts = new StuntJumps(city, game, hud, audio);
  acts.stunts = stunts;

  // delivery marker
  const mg = new THREE.CylinderGeometry(6, 6, 26, 18, 1, true);
  marker = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({
    color: 0xffd24a, transparent: true, opacity: 0.32, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
  }));
  marker.visible = false;
  scene.add(marker);

  buildPickups(scene, city);

  // Keep this launch's grading for the next one. Writing clones a few MB, so
  // it happens here on the loading screen rather than during play.
  const toKeep = [];
  if (bootCache.gradeOut) toKeep.push(['grade', () => bootCache.gradeOut]);
  if (world.bootCache.portalOut) toKeep.push(['portal', () => world.bootCache.portalOut]);
  if (bootCache.buildingsOut) toKeep.push(['buildings', () => bootCache.buildingsOut]);
  if (!bc.vehicles) toKeep.push(['vehicles', () => vehicleSnapshot()]);
  if (bcOut.texPlan) toKeep.push(['textures', () => encodeTextures(bcOut.texPlan)]);
  if (bcOut.mapCanvas) toKeep.push(['map', () => canvasToBlob(bcOut.mapCanvas)]);
  if (toKeep.length) {
    await step(0.93, 'Remembering the city');
    for (const [k, make] of toKeep) {
      const t0 = performance.now();
      let ok = false;
      try { const v = await within(Promise.resolve(make()), 10000); if (v) ok = await cachePut(k, v); } catch (e) { blog(`keep ${k}: ${e.message}`); }
      blog(`keep ${k}: ${ok ? 'saved' : 'not saved'} ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    }
  }
  bootCache.gradeOut = bootCache.buildingsOut = null;
  world.bootCache = null;
  await step(0.94, 'Opening the roads');
  for (let i = 0; i < 90; i++) {
    const left = world.update(player.x, player.z, 6);
    if (!left) break;
    if (i % 8 === 0) {
      loadBar.style.width = `${Math.round((0.94 + Math.min(1, i / 60) * 0.05) * 100)}%`;
      await new Promise((res) => requestAnimationFrame(res));
    }
  }

  await step(1, 'Welcome to Seattle');
  window.__refreshJobs = refreshJobs;
  window.__dbg = { game, city, player, world, traffic, peds, acts, stunts, monorail, lmRoot, shadowCache, fishing, fishSpots, scene, camera, renderer, G, fx, hud, controls, audio, pickups, THREE, postfx, applyQuality, sun, placeSun, sceneStats, perfSys, cityStats, WET_FLOOR, animateWalk, collideWithBuildings, TYPES: VEHICLE_TYPES };
  wireUi();
  game.newTarget();
  // Start on `high` everywhere.
  //
  // Phones were dropped to `medium` when the frame was 509 draws and a chunk
  // build could block for a quarter of a second. Both are fixed -- 299 draws
  // and a 17 ms worst frame -- and a modern phone measured 61 fps with a floor
  // of 57 at `high`. `autoQuality` is still watching, so a device that cannot
  // hold it steps down on its own rather than everyone being pre-emptively
  // demoted.
  let savedQ = null;
  try { savedQ = localStorage.getItem('auto-quality'); } catch (e) { /* private mode */ }
  // literal, not TIERS: that const lives further down and this runs at boot
  applyQuality(['high', 'medium', 'low'].includes(savedQ) ? savedQ : 'high', !!savedQ);
  // WARM-UP BEHIND THE LOADING SCREEN (apps/auto/CLAUDE.md, "Hitches").
  // Everything first-used used to happen in play: the pedestrian look pools
  // inside the first frame (224-264 ms at 8x), ~36 programs compiling while
  // the overlay faded, and later the vehicles' shadow-depth variant (a 468 ms
  // frame when the first car entered the shadow box), the far layers (first
  // climb past 45 m) and the boat wake.
  //
  // v98 did this and broke the game on the iPhone -- unplayable, no movement
  // -- while every Chrome harness passed. That version uploaded EVERY vehicle
  // type's geometry here (~20 types x 3 parts) for no measured gain; the likely
  // failure is WebKit's GPU process giving up under it. So now: one sedan's
  // parts only (the programs are shared by every type), and nothing in here
  // may stop the boot -- any error is logged, the stand-ins always come out,
  // and a lost context is reported instead of left for the first frame.
  try { warmLooks(); } catch (e) { blog(`warm looks: ${e.message}`); }
  // The audio graph and its sound bank, now: creating a context needs no
  // gesture (it starts suspended; wireUi's unlock resumes it), and the bank
  // is offline rendering that used to begin only at the first tap -- seconds
  // of silence on a phone before any footstep or door could play.
  try { audio.init(); } catch (e) { blog(`audio: ${e.message}`); }
  {
    const tw = performance.now();
    const warm = new THREE.Group();
    const wakeWas = fx.wakeMesh ? fx.wakeMesh.visible : false;
    let lazy = null;
    try {
      // Traffic has not spawned yet, so the stand-ins come from the asset
      // table. (paint is never disposed: that would release the program just
      // compiled, which no car is using yet.)
      const va = vehicleAssets(), sd = va.types.sedan, paint = paintMaterial(0xffffff);
      for (const [geo, mat] of [[sd.paintGeo, paint], [sd.trimGeoW, va.trimMat], [sd.matteGeoW, va.matteMat]]) {
        if (!geo) continue;
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        warm.add(m);
      }
      warm.position.set(player.x, player.y, player.z);
      // The layers built only later: far massing and far roads (their
      // materials on an empty draw range; the layers stay unallocated) and
      // the boat wake, hidden until then -- three compiles nothing it skips.
      lazy = world.warmMeshes();
      for (const m of lazy.meshes) warm.add(m);
      if (fx.wakeMesh) fx.wakeMesh.visible = true;
      scene.add(warm);
      placeSun(player.x, player.y, player.z);
      player.updateCamera(1 / 60, null);   // look where the first frame will
      // TWICE: three runs the shadow pass before it sets up the frame's
      // lights, and depth programs are keyed on the light counts, so a
      // renderer's first frame compiles them for zero lights and the next
      // for the real ones. One warm frame compiled the wrong copy.
      draw(tw);
      draw(tw + 16);
    } catch (e) {
      blog(`warm shaders: ${e.message}`);
    } finally {
      scene.remove(warm);
      if (fx.wakeMesh) fx.wakeMesh.visible = wakeWas;
      try { if (lazy) lazy.dispose(); } catch (e) { /* nothing to free */ }
    }
    const gl = renderer.getContext();
    blog(`warm: ${renderer.info.programs.length} programs, ${Math.round(performance.now() - tw)} ms${gl.isContextLost && gl.isContextLost() ? ' -- CONTEXT LOST' : ''}`);
  }
  startedAt = performance.now();
  loading.classList.add('hide');
  document.body.classList.add('booted');   // now the rotate prompt may show
  setTimeout(() => loading.remove(), 700);
  last = performance.now();
  requestAnimationFrame(frame);
  // The game is running: this launch did not die in the cache (see bootcache.js).
  requestAnimationFrame(() => requestAnimationFrame(() => cacheGuardSet(false)));
  blog('running');
  if (window.__bootOk) window.__bootOk();
}

// ---------------------------------------------------------------------------

function buildPickups(scene, city) {
  // Pickup sites are found in the map, not written down.
  //
  // These were fifteen hardcoded coordinates from the hand-drawn city. Against
  // real OSM data four of them had gone wrong: a health pack under Puget Sound
  // at y = -2.1, a pistol floating on the water at (620, -4200), and two more
  // sitting in a live carriageway. That is one of eight guns unobtainable, and
  // it is the same failure the beauty harness had -- coordinates outlive the
  // world they were measured in.
  //
  // Anchored to real places so they stay spread across the map and stay put
  // between sessions, then nudged to the nearest spot that is dry land, off the
  // carriageway and not inside a building.
  const anchors = [
    [-1150, -900], [240, 1400], [-2200, 1100], [900, -1400], [1500, -2400],
    [-960, -3760], [-300, 700], [-3400, -4000], [300, 1900], [2000, 600],
    [-1300, -1500], [1250, 2500], [-2600, 3600], [620, -4200], [-1800, -2600],
  ];
  const usable = (x, z) => !G.isWater(x, z) && G.terrainHeight(x, z) > 1.2
    && !city.onRoad(x, z, 1.5, false) && !world.inBuilding(x, z, 1.5);
  // Snap each anchor to the nearest street, then step off the carriageway onto
  // the verge. Spiralling out from the raw anchor is not enough on its own --
  // one of these sits well out in Puget Sound, and no search radius that stays
  // in the right neighbourhood will ever find land. A road node is guaranteed
  // to be somewhere you could stand.
  const spots = anchors.map(([ax, az], i) => {
    let nd = null, bestD = Infinity;
    for (const n of city.nodes) {
      if (n.elev) continue;
      const d2 = (n.x - ax) ** 2 + (n.z - az) ** 2;
      if (d2 < bestD) { bestD = d2; nd = n; }
    }
    const cx0 = nd ? nd.x : ax, cz0 = nd ? nd.z : az;
    for (let r = 6; r <= 60; r += 6) {
      for (let a = 0; a < 16; a++) {
        const th = (a / 16) * Math.PI * 2 + i;
        const x = cx0 + Math.cos(th) * r, z = cz0 + Math.sin(th) * r;
        if (usable(x, z)) return { x, z, kind: i % 2 ? 'health' : 'gun' };
      }
    }
    return { x: cx0, z: cz0, kind: i % 2 ? 'health' : 'gun' };
  });
  for (const s of spots) {
    const y = city.groundAt(s.x, s.z, null) + 1.1;
    const g = new THREE.Group();
    if (s.kind === 'gun') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.26, 0.28), new THREE.MeshLambertMaterial({ color: 0x2b3138 }));
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.24), new THREE.MeshLambertMaterial({ color: 0x3b2b20 }));
      h.position.set(-0.25, -0.3, 0);
      g.add(m, h);
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.25), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.28), new THREE.MeshBasicMaterial({ color: 0xe5484d }));
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.28), new THREE.MeshBasicMaterial({ color: 0xe5484d }));
      g.add(m, c1, c2);
    }
    const halo = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 3, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: s.kind === 'gun' ? 0x8fd1ff : 0x7ef0a4, transparent: true, opacity: 0.2, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false })
    );
    halo.position.y = 0.6;
    g.add(halo);
    g.position.set(s.x, y, s.z);
    scene.add(g);
    pickups.push({ ...s, y, g, taken: 0 });
  }
}

function updatePickups(dt) {
  const p = player.position;
  for (const pk of pickups) {
    if (pk.taken > 0) {
      pk.taken -= dt;
      continue;
    }
    // 3-4 draws each, and a metre-wide box past 300 m is a few pixels: they
    // were drawing from anywhere on the map.
    const near = dist2(p.x, p.z, pk.x, pk.z) < 300 * 300;
    if (pk.g.visible !== near) pk.g.visible = near;
    if (!near) continue;
    pk.g.rotation.y += dt * 1.6;
    pk.g.position.y = pk.y + Math.sin(performance.now() * 0.003) * 0.14;
    if (player.onFoot && dist2(p.x, p.z, pk.x, pk.z) < 4) {
      pk.taken = 30;
      pk.g.visible = false;
      audio.pickup(pk.kind);
      if (pk.kind === 'gun') {
        player.armed = true;
        player.ammo += 45;
        hud.showToast('Pistol — 45 rounds');
      } else {
        player.health = Math.min(100, player.health + 45);
        hud.showToast('Health restored');
      }
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Cursor over the pause menu for a pad.
 *
 * A cursor is not an action: being able to confirm and go back is useless if
 * the player cannot see WHICH row is about to be pressed, so every move paints
 * `.padfocus`. The ring keys off a pad being present rather than off "the last
 * input was a stick", because a player using only the d-pad would otherwise
 * navigate a menu that never highlights anything.
 */
function makePadMenu() {
  let rows = [];
  let i = 0;
  let on = false;
  const paint = () => {
    for (const r of rows) r.el.classList.toggle('padfocus', on && r === rows[i]);
  };
  return {
    open() {
      // Same order as the menu reads on screen -- Resume first.
      rows = [
        { el: document.getElementById('resumeBtn'), kind: 'click' },
        { el: document.getElementById('respawnBtn'), kind: 'click' },
        { el: document.getElementById('rowQuality'), kind: 'seg' },
        { el: document.getElementById('setShadows'), kind: 'click' },
        { el: document.getElementById('setMusic'), kind: 'click' },
        { el: document.getElementById('setSound'), kind: 'click' },
        { el: document.getElementById('setSens'), kind: 'range' },
      ].filter((r) => r.el);
      i = 0;
      on = true;
      paint();
    },
    close() {
      on = false;
      paint();
      rows = [];
    },
    get active() { return on && rows.length > 0; },
    move(d) {
      if (!this.active) return;
      i = (i + d + rows.length) % rows.length;
      paint();
    },
    adjust(d) {
      if (!this.active) return;
      const r = rows[i];
      if (r.kind === 'range') {
        const el = r.el;
        const step = parseFloat(el.step) || 0.1;
        el.value = String(clamp(parseFloat(el.value) + d * step,
          parseFloat(el.min), parseFloat(el.max)));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (r.kind === 'seg') {
        const opts = Array.from(document.querySelectorAll('[data-quality]'));
        const cur = opts.findIndex((o) => o.classList.contains('on'));
        const next = opts[clamp((cur < 0 ? 0 : cur) + d, 0, opts.length - 1)];
        if (next) next.click();
      }
    },
    confirm() {
      if (!this.active) return;
      const r = rows[i];
      if (r.kind === 'click') r.el.click();
      else if (r.kind === 'seg') this.adjust(1);
    },
  };
}
const padMenu = makePadMenu();
let setPausedRef = null;

/** Fill the Jobs list and the delivery buttons. Read only when paused. */
function refreshJobs() {
  if (!acts) return;
  const s = acts.summary();
  const cnt = document.getElementById('jobsCount');
  const mon = document.getElementById('jobsMoney');
  const list = document.getElementById('jobsList');
  if (cnt) cnt.textContent = `${s.done}/${s.total} · ${s.golds} gold · finds ${s.found}/${s.findTotal} · tech tour ${s.tech}/${s.techTotal}`;
  if (mon) mon.textContent = formatMoney(game.money);
  for (const b of document.querySelectorAll('.buy')) b.disabled = game.money < +b.dataset.cost;
  if (!list) return;
  const COL = { gold: '#f4c542', silver: '#c8d0d8', bronze: '#c0763c' };
  list.innerHTML = s.rows.map((r) => `<div class="jobRow"><span class="nm">${r.name}</span>`
    + `<span class="bt">${r.best || '--'}`
    + (r.medal && r.medal !== 'none' ? `<i class="md" style="background:${COL[r.medal]}"></i>` : '')
    + '</span></div>').join('');
}
let warpArmed = false;
let showStation = () => {};   // wireUi: mark the tuned station in the menu
// the menu/map idle (see frame): frames drawn since it opened, and a request
// for one more
let idleDrawn = 0, idleRedraw = false;
const pauseMenuEl = document.getElementById('pauseMenu');

function setMapOpen(v) {
  game.mapOpen = v;
  document.getElementById('mapOverlay').classList.toggle('show', v);
  if (v) hud.drawBigMap(player, game);
  else setWarpArmed(false);
}

function setWarpArmed(v) {
  warpArmed = v;
  document.getElementById('warpBtn').classList.toggle('on', v);
  document.getElementById('mapHint').textContent = v
    ? (controls.hasPad ? 'Stick to aim, Ⓐ to drop in' : 'Tap anywhere to drop in')
    : (controls.hasPad ? 'Ⓧ to set spawn, Ⓑ to close' : 'Tap the map to close');
  if (v) {
    // Start the crosshair on the player, so a pad has something to move.
    hud.warp = { x: player.position.x, z: player.position.z, ok: true, snap: null };
    refreshWarp(hud.warp.x, hud.warp.z);
  } else {
    hud.warp = null;
  }
  if (game.mapOpen) hud.drawBigMap(player, game);
}

/** Resolve a map point to the road it would drop you on, for the preview. */
function refreshWarp(x, z) {
  const snap = cityRef.respawnPointNear(x, z);
  hud.warp = { x, z, ok: !!snap, snap };
  if (game.mapOpen) hud.drawBigMap(player, game);
  return snap;
}

/**
 * Drop the player at a point picked off the map.
 *
 * Always snapped to a road node -- the tap is nearly always mid-block, and the
 * point of the feature is to arrive somewhere you can drive away from. If there
 * is no road within range (open water, the middle of Discovery Park) it refuses
 * and says so rather than putting the player in the trees.
 */
function warpTo(x, z) {
  const snap = refreshWarp(x, z);
  if (!snap) {
    hud.showToast('No road near there');
    return;
  }
  setMapOpen(false);
  player.respawn(snap.x, snap.z);
  controls.setMode('foot');
  game.dead = false;
  document.getElementById('wasted').classList.remove('show');
  world.update(snap.x, snap.z, 40);
  hud.showToast(`Dropped in — ${G.placeNameAt(snap.x, snap.z)}`);
  game.newTarget();
}

/**
 * Everything the pad drives outside gameplay. Runs before the pause check in
 * frame(), because the pad that opened the menu has to be able to work it.
 */
function handlePadUi(dt) {
  const u = controls.takeUi();

  if (u.pause) {
    if (game.mapOpen) setMapOpen(false);
    else if (setPausedRef) setPausedRef(!game.paused);
    return;
  }
  if (game.mapOpen) {
    if (u.warp) setWarpArmed(!warpArmed);
    if (warpArmed) {
      // The crosshair flies at a fixed metres-per-second so it crosses the
      // 16 km map in a sane time; the map is drawn at whatever zoom fits, so
      // moving in screen pixels would change speed with the window.
      const s = controls.padLook();
      const m = controls.padMove();
      const vx = (Math.abs(m.x) > Math.abs(s.x) ? m.x : s.x);
      const vz = (Math.abs(m.y) > Math.abs(s.y) ? m.y : s.y);
      if (vx || vz) {
        const sp = 2600 * dt;
        refreshWarp(
          G.clampToMap((hud.warp ? hud.warp.x : player.position.x) + vx * sp),
          G.clampToMap((hud.warp ? hud.warp.z : player.position.z) + vz * sp),
        );
      }
      if (u.confirm && hud.warp) { warpTo(hud.warp.x, hud.warp.z); return; }
      if (u.back) { setWarpArmed(false); return; }
      if (u.map) setMapOpen(false);
      return;
    }
    if (u.map || u.back || u.confirm) setMapOpen(false);
    return;
  }
  if (game.paused) {
    if (u.nav) padMenu.move(u.nav);
    if (u.navX) padMenu.adjust(u.navX);
    if (u.confirm) padMenu.confirm();
    if (u.back && setPausedRef) setPausedRef(false);
    return;
  }
  if (u.map) setMapOpen(true);
  if (u.radio) {
    audio.init();
    audio.resume();
    if (!audio.musicOn) {
      audio.musicOn = true;
      hud.showToast(`♪ ${audio.stationName()}`);
    } else {
      hud.showToast(`♪ ${audio.nextStation(u.radio > 0 ? 1 : -1)}`);
    }
  }
}

function wireUi() {
  const pause = document.getElementById('pauseMenu');
  const bigMapWrap = document.getElementById('mapOverlay');

  const setPaused = (v) => {
    game.paused = v;
    pause.classList.toggle('show', v);
    if (v) refreshJobs();          // the Jobs list is only ever read here
    if (v) showStation();
    if (v) padMenu.open(); else padMenu.close();
    // iOS suspends the AudioContext when the app goes to the background and
    // does not hand it back on its own, so the world would come back silent.
    if (!v) audio.resume();
  };
  setPausedRef = setPaused;
  document.getElementById('pauseBtn').addEventListener('click', () => setPaused(!game.paused));
  document.getElementById('resumeBtn').addEventListener('click', () => setPaused(false));
  // A setting changed in the menu (graphics, shadows, a post pass) shows
  // behind it: one redraw per tap.
  pause.addEventListener('click', () => { idleRedraw = true; });
  // Tap outside the card to close the menu, like the map.
  pause.addEventListener('click', (e) => { if (e.target === pause) setPaused(false); });
  // Tap the minimap to open the full map -- it replaced a dedicated button.
  document.getElementById('minimapWrap').addEventListener('click', () => {
    setMapOpen(!game.mapOpen);
  });
  document.getElementById('warpBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // the overlay's own click closes the map
    setWarpArmed(!warpArmed);
  });
  bigMapWrap.addEventListener('click', (e) => {
    // Armed, a tap on the map is a destination rather than "close". Disarmed,
    // the old behaviour is untouched: tap anywhere to dismiss.
    if (warpArmed) {
      const w = hud.mapToWorld(e.clientX, e.clientY);
      if (w) { warpTo(w.x, w.z); return; }
    }
    setMapOpen(false);
  });
  // RADIO on the driving pad: the next station. pointerdown, like every pad
  // button (the pad's own handler stops propagation, not this listener).
  const radioPad = document.querySelector('[data-btn="radio"]');
  if (radioPad) radioPad.addEventListener('pointerdown', () => {
    audio.init();
    audio.resume();
    audio.primeLive();
    if (!audio.musicOn) { audio.musicOn = true; game.settings.music = true; document.getElementById('setMusic').classList.add('on'); }
    else audio.nextStation();
    hud.showToast(`♪ ${audio.stationName()}`);
  });

  const bind = (id, key, apply) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      game.settings[key] = !game.settings[key];
      el.classList.toggle('on', game.settings[key]);
      apply(game.settings[key]);
    });
    el.classList.toggle('on', game.settings[key]);
  };
  bind('setShadows', 'shadows', (v) => { renderer.shadowMap.enabled = v && game.settings.quality !== 'low'; });
  for (const el of document.querySelectorAll('[data-quality]')) {
    el.addEventListener('click', () => applyQuality(el.dataset.quality, true));
  }
  bind('setMusic', 'music', (v) => { audio.musicOn = v; });
  // The station picker. The radio button in the HUD cycles the same list.
  const stEl = document.getElementById('stations');
  const stBtns = STATION_NAMES.map((st, i) => {
    const b = document.createElement('button');
    b.className = 'stn';
    b.textContent = st.name;
    if (!st.live) { const t = document.createElement('span'); t.className = 'syn'; t.textContent = ' · synth'; b.appendChild(t); }
    b.addEventListener('click', () => {
      audio.init();
      audio.resume();
      audio.primeLive();
      audio.setStation(i);
      audio.musicOn = true;
      game.settings.music = true;
      document.getElementById('setMusic').classList.add('on');
      showStation();
    });
    stEl.appendChild(b);
    return b;
  });
  showStation = () => stBtns.forEach((b, i) => {
    b.classList.toggle('on', i === audio.station);
    b.style.display = audio.playable(i) ? '' : 'none';
  });
  bind('setSound', 'sound', (v) => { audio.enabled = v; });
  bind('setDebug', 'debug', (v) => { debugEl.classList.toggle('on', v); });
  bind('setPost', 'post', (v) => { postfx.setPostEnabled(v); });

  // Per-pass switches. `scene.fog` is nulled rather than zeroed because the fog
  // term is compiled into every material -- setting density to 0 still pays for
  // it, and the question being answered is what things cost as well as what
  // they look like.
  let savedFog = null;
  for (const b of document.querySelectorAll('.dbg')) {
    b.addEventListener('click', () => {
      const on = !b.classList.contains('on');
      b.classList.toggle('on', on);
      if (b.dataset.fx) postfx.setFx(b.dataset.fx, on);
      else if (b.dataset.world === 'fog') {
        if (on) { scene.fog = savedFog || scene.fog; }
        else { savedFog = scene.fog; scene.fog = null; }
        scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
      }
    });
  }

  const sens = document.getElementById('setSens');
  sens.addEventListener('input', () => {
    controls.sensitivity = parseFloat(sens.value);
  });

  document.getElementById('respawnBtn').addEventListener('click', () => {
    setPaused(false);
    doRespawn();
  });

  // UNLOCK ON A GESTURE THE BROWSER ACCEPTS, AND KEEP TRYING UNTIL IT TAKES.
  // This listened for the first pointerdown and then removed itself. A TOUCH
  // pointerdown is not user activation (only pointerup / touchend / click
  // are, plus keydown and a mouse's pointerdown), so on the iPhone the first
  // touch -- the stick, to walk -- created the context but could not start
  // it, and the listener was gone: the world stayed silent until some later
  // resume() happened to land inside a real gesture (unpausing, the radio
  // button), and then everything started at once. Capture phase, because the
  // on-screen buttons stop propagation. The context itself is created at boot
  // (audio.init() before the reveal), so the sound bank renders while you
  // load instead of after the first tap.
  const UNLOCK = ['pointerup', 'touchend', 'click', 'keydown', 'pointerdown'];
  // And the listeners STAY. They used to remove themselves once the context
  // first ran, so when iOS stopped it later (the home screen, a call, Siri)
  // no tap could ever start it again and the game went silent for good. A
  // running context makes this a single state check.
  const startAudio = () => {
    if (audio.ctx && audio.ctx.state === 'running' && audio._livePrimed) return;
    audio.init();
    audio.resume();
    // Same gesture, so Safari counts the stream as user-initiated. Getting into
    // a car happens in the frame loop and would be rejected on its own.
    audio.primeLive();
  };
  for (const ev of UNLOCK) window.addEventListener(ev, startAudio, true);

  // Size from the canvas box, not window.inner*: in iOS standalone the document
  // is taller than the visual viewport by the status-bar inset.
  const fit = () => {
    idleRedraw = true;   // a resize clears the canvas
    const c = renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    postfx.setSize(w, h, renderer.getPixelRatio());
    hud.resize();
  };
  window.addEventListener('resize', fit);
  renderer.domElement.addEventListener('webglcontextrestored', () => { idleRedraw = true; });
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  fit();
  // Pause on the way out, but through setPaused so the menu comes WITH it.
  // Setting game.paused directly stopped the world without showing anything to
  // tap, so coming back from the home screen looked like a hung game -- the
  // only way out was the pause button, which nobody presses on a frozen app.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true);
    else if (game.paused) { pause.classList.add('show'); idleRedraw = true; }
  });
}

function doRespawn() {
  game.dead = false;
  game.wanted = 0;
  game.points = 0;
  game.money = Math.max(0, game.money - 200);
  document.getElementById('wasted').classList.remove('show');
  player.respawn(HOSPITAL.x, HOSPITAL.z);
  controls.setMode('foot');
  hud.showToast('Harborview Medical Center');
}

// ---------------------------------------------------------------------------

// Per-system CPU time in the frame loop, behind a debug flag: on while the
// pause-menu debug readout is (it prints the top systems there, which is the
// only profiler a phone has), or `__dbg.perfSys.on = true` from a harness
// (tools/perfbisect.mjs). Off, it costs one branch per system.
const perfSys = { on: false, ms: {}, frames: 0 };
let perfT = 0;
let helloCd = 0;   // seconds until the next place may say hello
let balloonCheck = 5;

/**
 * Each fishing site at the outermost walkable point of its deck: the platform
 * point nearest the site that has open water a few metres beyond it, the one
 * furthest from the shore. The rod stands there, facing the water.
 */
function fishingSpots() {
  const out = [];
  for (const site of FISHING_SITES) {
    let best = null;
    for (let dz = -70; dz <= 70; dz += 2) for (let dx = -70; dx <= 70; dx += 2) {
      const x = site.x + dx, z = site.z + dz;
      const y = cityRef.platformAt(x, z);
      if (y == null) continue;
      // which way is open water, right past the edge?
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, ox = Math.sin(a), oz = Math.cos(a);
        const ex = x + ox * 2.2, ez = z + oz * 2.2;
        if (cityRef.platformAt(ex, ez) != null || !G.isWater(ex, ez) || !G.isWater(x + ox * 14, z + oz * 14)) continue;
        const score = G.shoreDist(x, z) - Math.hypot(dx, dz) * 0.2;
        if (!best || score > best.score) best = { x, z, y, heading: a, score };
      }
    }
    if (!best) { blog(`fishing: no deck edge at ${site.name}`); continue; }
    const wl = world.waterLevelAt(best.x, best.z);
    // the player stands a metre in from the edge; the rod stand beside them
    const fx = Math.sin(best.heading), fz = Math.cos(best.heading), rx = fz, rz = -fx;
    const sp = { name: site.name, x: best.x - fx * 0.9, z: best.z - fz * 0.9, y: best.y, heading: best.heading,
      water: wl !== null ? wl : 0, rx: best.x - fx * 0.5 + rx * 1.1, rz: best.z - fz * 0.5 + rz * 1.1 };
    sp.prop = fishingProp(sp);
    out.push(sp);
  }
  return out;
}

/** A rod in a stand, a bucket and a tackle box, on the deck at a spot. */
function fishingProp(sp) {
  const b = new Builder(false);
  const fx = Math.sin(sp.heading), fz = Math.cos(sp.heading), rx = fz, rz = -fx;
  const X = sp.rx, Z = sp.rz, Y = sp.y;
  b.box(X, Y, Z, 0.12, 0.9, 0.12, sp.heading, [0.35, 0.25, 0.16]);                         // stand post
  b.prism(X + rx * 0.7, Y, Z + rz * 0.7, 0.16, 0.34, 10, [0.85, 0.85, 0.82]);               // bucket
  b.prism(X + rx * 0.7, Y + 0.32, Z + rz * 0.7, 0.17, 0.03, 10, [0.62, 0.62, 0.6]);
  b.box(X - rx * 0.55, Y, Z - rz * 0.55, 0.42, 0.2, 0.24, sp.heading, [0.2, 0.42, 0.24]);   // tackle box
  const g = new THREE.Group();
  const m = new THREE.Mesh(b.build(), world.mats.flat);
  m.castShadow = true;
  g.add(m);
  // the rod itself, leaning out over the water from the stand
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.016, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.5, metalness: 0.3 }));
  rod.position.set(X + fx * 0.6, Y + 1.5, Z + fz * 0.6);
  rod.rotation.order = 'YXZ';
  rod.rotation.y = sp.heading;
  rod.rotation.x = 0.75;
  g.add(rod);
  g.userData.rod = rod;
  scene.add(g);
  return g;
}
/** The balloon, inflated and waiting on its launch field. */
function spawnBalloon() {
  const v = traffic.spawnAt(BALLOON_SITE.x, BALLOON_SITE.z, BALLOON_SITE.heading, 'balloon', 0xffffff, 'apron');
  v.vLong = 0;
  return v;
}
function lap(name) {
  const t = performance.now();
  perfSys.ms[name] = (perfSys.ms[name] || 0) + (t - perfT);
  perfT = t;
}

function frame(now) {
  requestAnimationFrame(frame);
  const prof = perfSys.on;
  if (prof) { perfT = performance.now(); perfSys.frames++; }
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.06) dt = 0.06;
  if (dt <= 0) return;

  frames++;
  accumFps += dt;
  if (accumFps > 0.5) {
    fps = frames / accumFps;
    frames = 0;
    accumFps = 0;
  }

  // Poll and service the pad BEFORE the pause check: the pad that opened the
  // menu is the one that has to be able to work it, and a paused frame returns
  // early. takeLook() below then throws away any stick look accumulated while
  // the menu was up, so the camera doesn't lurch on resume.
  controls.poll(dt);
  handlePadUi(dt);

  if (fishing && fishing.active) fishing.update(dt);
  if (game.paused || game.mapOpen) {
    controls.takeLook();
    // NOTHING MOVES BEHIND THE MENU OR THE MAP, so stop drawing it. The whole
    // city, shadows and post chain were redrawn 60 times a second behind an
    // 86 %-opaque overlay: a paused phone ran as hot as a playing one. Two
    // frames after it opens (the second takes anything the first compiled),
    // then the canvas keeps the last one until something asks for a redraw
    // (idleRedraw: a resize, a setting). Only when the menu is SHOWING or the
    // map is open: harnesses pause the game without the menu to pose shots,
    // and those still draw every frame.
    // (the fishing game's screen covers the city too, once it is up)
    const idle = game.mapOpen || pauseMenuEl.classList.contains('show') || (fishing && fishing.el.classList.contains('show'));
    if (!idle || idleDrawn < 2 || idleRedraw) { draw(now); idleDrawn++; idleRedraw = false; }
    return;
  }
  idleDrawn = 0;

  const input = controls.read();
  const look = controls.takeLook();
  // Slow motion through the middle of a big stunt jump (stunts.js eases it in
  // and out, and it is off before touchdown). The whole sim slows together.
  if (stunts && stunts.timeScale < 1) dt *= stunts.timeScale;

  if (game.dead) {
    game.deathT += dt;
    controls.takeTap();
    if (game.deathT > 2.6) doRespawn();
  } else {
    player.update(dt, input, look, controls, traffic, peds);
  }
  monorail.update(dt);
  if (prof) lap('player');

  const p = player.position;
  const camDir = { x: p.x - player.camPos.x, z: p.z - player.camPos.z };
  const cl = Math.hypot(camDir.x, camDir.z) || 1;
  camDir.x /= cl; camDir.z /= cl;

  if (prof) lap('misc');
  traffic.update(dt, p.x, p.z, camDir, player);
  if (prof) lap('traffic');
  peds.update(dt, p.x, p.z, player, traffic);
  if (prof) lap('peds');
  if (stunts) stunts.update(dt, player);
  if (acts) acts.update(dt, player);
  // Say hello once per approach to anything the map marks (the dock, the
  // quads): the map is how you find them, this is how you know you have.
  // One at a time, in list order, so the dock is never talked over by the
  // quad parked beside it: the next waits for this one's toast to finish.
  helloCd = Math.max(0, helloCd - dt);
  // There is always a balloon: one left somewhere and lost (a wreck, a
  // despawn) is replaced at Jefferson Park, out of sight of the player.
  if ((balloonCheck -= dt) <= 0) {
    balloonCheck = 5;
    if (!traffic.cars.some((v) => v.spec.balloon) && dist2(p.x, p.z, BALLOON_SITE.x, BALLOON_SITE.z) > 400 * 400) spawnBalloon();
  }
  for (const pl of hud.places) {
    const d2 = dist2(pl.x, pl.z, p.x, p.z);
    if (pl.near) { if (d2 > 110 * 110) pl.near = false; continue; }
    if (d2 < 55 * 55 && helloCd <= 0) {
      pl.near = true;
      if (pl.hello) { hud.showToast(pl.hello, 4200); helloCd = 4.6; }
    }
  }
  if (prof) lap('activities');
  // UNDERGROUND, THE HELICOPTER LOSES YOU. This is what makes a bore a
  // tactical option rather than scenery you drive through: the roof over your
  // head is the only place in the city the air unit cannot see.
  let buried = false;
  {
    const terr = G.terrainHeight(p.x, p.z);
    buried = terr - p.y > 3;
    traffic.heliBlind = buried;
    if (buried && game.wanted > 0 && !hud.__toldTunnel) {
      hud.__toldTunnel = true;
      hud.showToast('Off the radar — the chopper has lost you');
    }
    if (!buried) hud.__toldTunnel = false;
  }
  updatePickups(dt);
  if (!player.vehicle || !player.vehicle.spec.boat) fx.wake(dt, null);
  fx.update(dt);

  // engine smoke / skid marks
  if (player.vehicle) {
    const v = player.vehicle;
    if (v.skid > 0.35 && Math.random() < 0.5) {
      fx.smoke(v.x - v.forward.x * v.halfLen, v.y + 0.15, v.z - v.forward.z * v.halfLen, 1);
    }
    if (v.health < 45 && Math.random() < 0.35) {
      fx.smoke(v.x + v.forward.x * v.halfLen, v.y + 0.9, v.z + v.forward.z * v.halfLen, 1);
    }
    // A boat leaves a wake: a foam ribbon from the transom (one draw, only
    // while you are driving one) and spray off the bow once it is moving.
    if (v.spec.boat) {
      fx.wake(dt, v);
      const sp = Math.abs(v.vLong);
      if (sp > 6 && Math.random() < 0.4) {
        const f = v.forward, s = Math.random() < 0.5 ? 1 : -1;
        fx.emit(v.x + f.x * v.halfLen * 0.55 + f.z * s * 1.1, v.y + 0.15, v.z + f.z * v.halfLen * 0.55 - f.x * s * 1.1, 2,
          { r: 0.92, g: 0.95, b: 0.97, size: 0.55, life: 0.55, spread: 1.2, vy: 1.4, grav: -9, drag: 0.9,
            vx: f.z * s * 2.2, vz: -f.x * s * 2.2 });
      }
    }
  }

  // wanted cool-down: stay clear of the law and the heat drops
  if (game.wanted > 0) {
    let nearCop = false;
    for (const c of traffic.cars) {
      if (c.mode === 'police' && dist2(c.x, c.z, p.x, p.z) < 110 * 110) { nearCop = true; break; }
    }
    if (!nearCop) {
      game.cool += dt;
      const need = 7 + game.wanted * 3;
      if (game.cool > need) {
        game.cool = 0;
        game.points = STAR_POINTS[Math.max(0, game.wanted - 1)];
        game.wanted = Math.max(0, game.wanted - 1);
        if (game.wanted === 0) hud.showToast('You lost the cops');
      }
    } else game.cool = 0;
  } else {
    game.points = Math.max(0, game.points - dt * 6);
  }

  game.checkTarget();

  // marker pulse
  if (marker.visible) {
    marker.rotation.y += dt * 0.7;
    marker.material.opacity = 0.22 + Math.sin(now * 0.004) * 0.1;
  }

  // Feed the streamer the two facts that let it keep up with a plane: how
  // high we are (build massing-only near chunks at altitude) and which way we
  // are moving (build ahead of the nose first).
  world.playerAlt = Math.max(0, p.y - G.terrainHeight(p.x, p.z));
  {
    const pv = player.vehicle;
    const fast = pv && Math.abs(pv.vLong) > 8;
    world.playerFwdX = fast ? pv.forward.x * Math.sign(pv.vLong) : 0;
    world.playerFwdZ = fast ? pv.forward.z * Math.sign(pv.vLong) : 0;
    world.playerFlying = !!(pv && pv.spec.plane && pv.airborne);
  }
  if (prof) lap('misc');
  world.update(p.x, p.z, fps < 45 ? 1 : 2);
  if (prof) lap('world');
  // Atmospheric haze thickens with altitude. From 300 m up the streaming
  // rings are visible as a crawling boundary -- massing at 1.6 km, detail at
  // 800 m -- and no draw budget pushes them past a 6 km sightline. Real air
  // does the job instead: by ~250 m up the density has doubled, so chunks
  // arrive inside the haze the way a distant city fades in from a real
  // light aircraft. On the ground this is exactly the old constant.
  if (scene.fog) {
    const alt = Math.max(0, p.y - G.terrainHeight(p.x, p.z));
    scene.fog.density = baseFogDensity * (1 + Math.min(2.2, alt / 220));
  }

  player.applyCamera(camera);
  placeSun(p.x, p.y, p.z);
  if (prof) lap('camera');

  // audio state
  if (audio.ready) audio.update(dt, audioState(dt, input, p, camDir, buried));

  if (prof) lap('misc');
  hud.update(dt, game, player, traffic);
  if (prof) lap('hud');
  world.animate(dt, now / 1000);
  if (prof) lap('animate');
  draw(now);
  // Render submission: three's scene walk, culling, sorting and the GL calls
  // (the GPU's own time is not in here).
  if (prof) lap('render');

  updateDebug(dt);
}

// What the sound needs from the frame. The surface under the player is a road,
// lot and park lookup, so it is refreshed five times a second, not per frame.
let surfT = 0, surfNow = 'hard';
const listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1, vx: 0, vz: 0 };
function surfaceAt(x, y, z) {
  const terr = G.terrainHeight(x, z);
  // on a deck, a bridge or in a bore it is concrete whatever is below
  if (y - terr > 1.5 || terr - y > 2) return 'hard';
  if (cityRef.onRoad(x, z, 2.5)) return 'hard';
  const lot = G.lotAt(x, z);
  // ballast and beach sand crunch; every other lot is paved
  if (lot >= 0) return G.LOT_KINDS[lot] === 'rail' || G.LOT_KINDS[lot] === 'sand' ? 'gravel' : 'hard';
  return 'grass';
}
// Traffic's engine voices take the nearest cars from this list; the
// monorail's trains in service ride along, so one passing overhead is heard.
const audioCars = [];
function withTrains(cars) {
  audioCars.length = 0;
  for (let i = 0; i < cars.length; i++) audioCars.push(cars[i]);
  if (monorail && monorail.trains) for (const t of Object.values(monorail.trains)) if (t !== player.vehicle) audioCars.push(t);
  return audioCars;
}
function audioState(dt, input, p, camDir, buried) {
  const v = player.vehicle;
  if ((surfT -= dt) <= 0) {
    surfT = 0.2;
    surfNow = surfaceAt(p.x, p.y, p.z);
  }
  const wl = world.waterLevelAt(p.x, p.z);
  const wetMask = wl !== null && G.isWater(p.x, p.z);
  const depth = wetMask ? wl - p.y : 0;
  const spec = v ? v.spec : null;
  const floating = !!(spec && (spec.floats || spec.boat));
  const water = v ? (!floating && depth > 0 ? depth : 0) : depth > 0.05 ? depth : 0;
  listener.x = camera.position.x; listener.y = camera.position.y; listener.z = camera.position.z;
  listener.fx = camDir.x; listener.fz = camDir.z;
  if (v) {
    const f = v.forward;
    listener.vx = f.x * v.vLong; listener.vz = f.z * v.vLong;
  } else {
    listener.vx = Math.sin(player.heading) * player.speed;
    listener.vz = Math.cos(player.heading) * player.speed;
  }
  const h = player.h;
  const hp = traffic.heli ? traffic.heli.g.position : null;
  return {
    inCar: !player.onFoot,
    onFoot: player.onFoot,
    vehicle: v,
    spec,
    speed: v ? (v.spec.balloon ? 0 : v.vLong) : 0,
    burner: !!(v && v.spec.balloon && v.burning),
    // a balloon moves WITH the air: no rush of wind at any speed
    // A helicopter's turbine runs at governed speed whatever the collective
    // is doing: the note follows the rotor spool, not the UP button.
    throttle: !v ? 0 : v.spec.heli ? 0.6 * (v.spool || 0) + (input.gas ? 0.4 : 0)
      : input.gasAmt != null ? input.gasAmt : input.gas ? 1 : 0,
    brake: v ? (input.brakeAmt != null ? input.brakeAmt : input.brake ? 1 : 0) : 0,
    skid: v ? v.skid : 0,
    airborne: !!(v && v.airborne),
    carAirborne: !!(v && !spec.plane && v.onGround === false),
    wading: !!(v && !floating && depth > 0.35),
    onWater: !!(v && floating && wetMask && depth > -0.8 && !v.airborne),
    scrape: v && player.scrapeT > 0 ? clamp(Math.abs(v.vLong) / 10, 0.3, 1) : 0,
    water,
    impactSpeed: v ? Math.abs(v.vLong) + Math.abs(v.vy || 0) : Math.abs(player.vy || 0) + player.speed,
    surface: water > 0.05 ? 'water' : surfNow,
    footL: h.contactL, footR: h.contactR,
    footSpeed: player.speed,
    falling: player.onFoot && !player.grounded,
    fallSpeed: player.onFoot ? player.vy : 0,
    enclosed: buried,
    listener,
    cars: withTrains(traffic.cars),
    heli: hp,
  };
}

function draw(now) {
  const prof = perfSys.on;
  // The render lap split three ways for the phone readout: the shadow pass
  // (timed inside renderer.render by wrapping shadowMap.render), the rest of
  // the scene pass, and the post chain. Which one dominates decides whether
  // the next cut is casters, draws or fill.
  if (prof && !renderer.shadowMap.__timed) {
    const sm = renderer.shadowMap, orig = sm.render;
    sm.render = function (...a) {
      const t0 = performance.now(), c0 = renderer.info.render.calls;
      orig.apply(this, a);
      perfRender.shadowMs += performance.now() - t0;
      perfRender.shadowCalls += renderer.info.render.calls - c0;
    };
    sm.__timed = true;
  }
  const t0 = prof ? performance.now() : 0;
  if (lmRoot && updateLandmarkRange(lmRoot, camera.position) && shadowCache) shadowCache.invalidate();
  renderer.setRenderTarget(postfx.target);
  renderer.render(scene, camera);
  // capture before the post passes reset the counters
  sceneStats.calls = renderer.info.render.calls;
  sceneStats.tris = renderer.info.render.triangles;
  const t1 = prof ? performance.now() : 0;
  postfx.render(now / 1000, camera);
  renderer.setRenderTarget(null);
  if (prof) {
    perfRender.sceneMs += t1 - t0;
    perfRender.postMs += performance.now() - t1;
    perfRender.frames++;
  }
}
const sceneStats = { calls: 0, tris: 0 };
const perfRender = { shadowMs: 0, shadowCalls: 0, sceneMs: 0, postMs: 0, frames: 0 };
const debugEl = document.getElementById('debugStats');
let debugAcc = 0;
let fpsMin = 999;

/**
 * On-device performance readout.
 *
 * The draw-call and triangle budget this game is written against was a
 * convention -- "it ships to a phone" -- and was never measured on one. The
 * scene has been over the documented 290-320 calls / 400k triangles for a
 * while with nothing going wrong, which means nobody knows where the real
 * ceiling is. Reading it off the device settles that.
 *
 * Worst-case frame rate matters more than the mean: a mean of 60 with a
 * regular dip to 38 is what actually trips `autoQuality`, and an average hides
 * it. `fpsMin` holds the floor since the last redraw of this panel.
 */
function perfLine() {
  const n = perfSys.frames;
  if (!n) return '';
  const top = Object.entries(perfSys.ms).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join('  ');
  perfSys.ms = {};
  perfSys.frames = 0;
  const r = perfRender, rn = r.frames || 1;
  // sceneMs includes the shadow pass, which runs inside renderer.render.
  const rl = `\nrender ms: shadow ${(r.shadowMs / rn).toFixed(1)} (${Math.round(r.shadowCalls / rn)} draws)`
    + `  scene ${((r.sceneMs - r.shadowMs) / rn).toFixed(1)}  post ${(r.postMs / rn).toFixed(1)}`;
  r.shadowMs = r.shadowCalls = r.sceneMs = r.postMs = r.frames = 0;
  return `\ncpu ms: ${top}${rl}`;
}

function updateDebug(dt) {
  perfSys.on = game.settings.debug || perfSys.harness === true;
  if (!game.settings.debug) return;
  fpsMin = Math.min(fpsMin, fps);
  debugAcc += dt;
  if (debugAcc < 0.25) return;
  debugAcc = 0;
  const q = game.settings.quality;
  const dpr = renderer.getPixelRatio().toFixed(2);
  const w = Math.round(renderer.domElement.clientWidth * renderer.getPixelRatio());
  const h = Math.round(renderer.domElement.clientHeight * renderer.getPixelRatio());
  const cars = traffic.cars.length;
  const people = peds.peds.length;
  debugEl.textContent =
    `${fps.toFixed(0)} fps  (min ${fpsMin.toFixed(0)})\n`
    + `${sceneStats.calls} draws  ${(sceneStats.tris / 1000).toFixed(0)}k tris\n`
    + `${w}x${h} @ ${dpr}x  ${q}\n`
    + `${cars} vehicles  ${people} peds`
    + perfLine();
  fpsMin = fps;
}

// The phone this ships to can't be profiled from here, so the game measures
// itself and steps the quality down if it can't hold frame rate.
const TIERS = ['high', 'medium', 'low'];
let tierIdx = 0;
let slowFor = 0;
let qualityLocked = false;

// The adaptive quality ladder is GONE, by request. It watched fps with no
// idea why a frame was slow, demoted people after warps, and even with a
// streaming guard and a recovery rung it kept overriding a choice the player
// had made on purpose. The picker in the pause menu is now the only
// authority, and the choice persists in localStorage.
function autoQuality() {}

function applyQuality(q, manual) {
  if (manual) {
    qualityLocked = true;
    try { localStorage.setItem('auto-quality', q); } catch (e) { /* private mode */ }
  }
  // Keep the ladder position in step whether the change was manual or not --
  // starting a phone on `medium` with tierIdx still at 0 made the first
  // automatic step down re-apply medium and waste a rung.
  tierIdx = Math.max(0, TIERS.indexOf(q));
  game.settings.quality = q;
  idleRedraw = true;
  postfx.setQuality(q, ON_PHONE);
  renderer.shadowMap.enabled = q !== 'low' && game.settings.shadows;
  // Pixel ratio is the single biggest fill-rate dial there is: 2.0 against
  // 1.45 is 1.9x the pixels through every one of the post chain's fullscreen
  // passes. A phone was capped at 2 on `high`, which is where most of the cost
  // went.
  const cap = q === 'high' ? (ON_PHONE ? 1.45 : 1.6) : q === 'medium' ? (ON_PHONE ? 1.3 : 1.5) : 1.15;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  renderer.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight, false);
  postfx.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight, renderer.getPixelRatio());
  for (const el of document.querySelectorAll('[data-quality]')) {
    el.classList.toggle('on', el.dataset.quality === q);
  }
}

boot().catch((e) => {
  loadMsg.textContent = 'Failed to start: ' + e.message;
  blog('FAILED ' + (e.stack || e.message));
  console.error(e);
});
