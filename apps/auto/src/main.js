// AUTO -- an open-world Seattle you can drive around.

import * as THREE from './three.js';
import * as G from './geo.js';
import { cityGenerator } from './citygen.js';
import { buildTextures } from './textures.js';
import { World } from './world.js';
import { buildLandmarks } from './landmarks.js';
import { TrafficSystem } from './traffic.js';
import { PedSystem } from './peds.js';
import { Player } from './player.js';
import { Controls } from './controls.js';
import { Hud, buildMapCanvas } from './hud.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { PostFX } from './postfx.js';
import { clamp, lerp, rng, dist2, formatMoney } from './util.js';

const app = document.getElementById('app');
const loadBar = document.getElementById('loadBar');
const loadMsg = document.getElementById('loadMsg');
const loading = document.getElementById('loading');

const STAR_POINTS = [0, 30, 90, 190, 340, 560];
const HOSPITAL = { x: 1050, z: 300 };

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
      audio.wanted();
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

  onPedHit(byPlayer, ped) {
    audio.burst(0.2, 320, 0.8, 0.4);
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
    audio.gunshot();
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

  onEnterVehicle(v) {
    controls.setMode('drive');
    audio.blip(300, 0.12, 'square', 0.2);
    if (v.mode === 'parked' || v.wasParked) this.addHeat(8);
    hud.showToast(v.typeName === 'police' ? 'Police cruiser commandeered' : 'Vehicle acquired');
  }

  onExitVehicle() {
    controls.setMode('foot');
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
    audio.crash(30);
    peds.scare(v.x, v.z, 45);
    if (v === player.vehicle) {
      this.damagePlayer(70, 'explosion');
      player.exitVehicle();
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

let renderer, scene, camera, sun, world, cityRef, traffic, peds, player, controls, hud, fx, audio, game, marker, postfx;
let pickups = [];
let last = 0;
let accumFps = 0, frames = 0, fps = 60;
let startedAt = 0;

async function boot() {
  const step = async (p, msg) => {
    loadBar.style.width = `${Math.round(p * 100)}%`;
    loadMsg.textContent = msg;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  await step(0.02, 'Painting the city');
  const tx = buildTextures();

  await step(0.06, 'Carving the hills');
  const hfGen = G.bakeHeightfield();
  let hfr = hfGen.next();
  while (!hfr.done) {
    loadBar.style.width = `${Math.round((0.06 + hfr.value * 0.12) * 100)}%`;
    await new Promise((r) => requestAnimationFrame(r));
    hfr = hfGen.next();
  }

  await step(0.18, 'Laying out the streets');
  const gen = cityGenerator();
  let r = gen.next();
  while (!r.done) {
    loadBar.style.width = `${Math.round((0.18 + r.value.p * 0.44) * 100)}%`;
    loadMsg.textContent = r.value.msg;
    await new Promise((res) => requestAnimationFrame(res));
    r = gen.next();
  }
  const city = r.value;
  cityRef = city;

  await step(0.64, 'Raising the terrain');

  // --- renderer ---
  const canvas = document.getElementById('gl');
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  // Antialiasing comes from FXAA in the post chain, so the context never needs
  // MSAA -- which also means the scene can render into a target for free.
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 1.6));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  const viewW = () => canvas.clientWidth || window.innerWidth;
  const viewH = () => canvas.clientHeight || window.innerHeight;
  renderer.setSize(viewW(), viewH(), false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xb9c6d0, 0.00032);
  camera = new THREE.PerspectiveCamera(62, viewW() / viewH(), 0.5, 9000);

  // The sky IBL supplies most of the ambient, so the analytic lights are just a
  // key with a cool bounce fill.
  const hemi = new THREE.HemisphereLight(0xdcecf6, 0x7b8474, 2.0);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
  sun.position.set(-160, 240, -110);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 620;
  const S = 105;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  postfx = new PostFX(renderer);
  postfx.setSize(viewW(), viewH(), renderer.getPixelRatio());

  world = new World(scene, city, tx, { shadows: true, renderer });
  world.buildSky();
  const terrGen = world.buildTerrain();
  let tr = terrGen.next();
  while (!tr.done) {
    loadBar.style.width = `${Math.round((0.64 + tr.value * 0.14) * 100)}%`;
    await new Promise((res) => requestAnimationFrame(res));
    tr = terrGen.next();
  }
  world.buildWater();

  await step(0.8, 'Building the skyline');
  world.buildSkyline();

  await step(0.86, 'Placing the landmarks');
  buildLandmarks(scene);

  await step(0.9, 'Waking the city');
  game = new Game();
  audio = new Audio();
  controls = new Controls(document.getElementById('app'));
  player = new Player(scene, city, game);
  traffic = new TrafficSystem(scene, city, game);
  peds = new PedSystem(scene, city, game);
  fx = new Effects(scene, tx);
  const mapCanvas = buildMapCanvas(city);
  hud = new Hud(document.getElementById('app'), city, mapCanvas);

  // delivery marker
  const mg = new THREE.CylinderGeometry(6, 6, 26, 18, 1, true);
  marker = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({
    color: 0xffd24a, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
  }));
  marker.visible = false;
  scene.add(marker);

  buildPickups(scene, city);

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
  window.__dbg = { game, city, player, world, traffic, peds, scene, camera, renderer, G, fx, hud, controls, audio, pickups, THREE, postfx, applyQuality, sun, sceneStats };
  wireUi();
  game.newTarget();
  applyQuality('high', false);
  startedAt = performance.now();
  loading.classList.add('hide');
  setTimeout(() => loading.remove(), 700);
  last = performance.now();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------

function buildPickups(scene, city) {
  const spots = [
    { x: -1150, z: -900, kind: 'gun' },
    { x: 240, z: 1400, kind: 'gun' },
    { x: -300, z: -1300, kind: 'health' },
    { x: 900, z: -1400, kind: 'gun' },
    { x: 1050, z: 240, kind: 'health' },
    { x: -960, z: -3760, kind: 'gun' },
    { x: 1400, z: -3900, kind: 'health' },
    { x: -2900, z: 2400, kind: 'health' },
    { x: -3400, z: -4000, kind: 'gun' },
    { x: 300, z: 1900, kind: 'health' },
    { x: 2000, z: 600, kind: 'gun' },
    { x: -1300, z: -1500, kind: 'health' },
    { x: 1250, z: 2500, kind: 'gun' },
    { x: -2600, z: 3600, kind: 'health' },
    { x: 620, z: -4200, kind: 'gun' },
  ];
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
      new THREE.MeshBasicMaterial({ color: s.kind === 'gun' ? 0x8fd1ff : 0x7ef0a4, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })
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
      if (pk.taken <= 0) pk.g.visible = true;
      continue;
    }
    pk.g.rotation.y += dt * 1.6;
    pk.g.position.y = pk.y + Math.sin(performance.now() * 0.003) * 0.14;
    if (player.onFoot && dist2(p.x, p.z, pk.x, pk.z) < 4) {
      pk.taken = 30;
      pk.g.visible = false;
      audio.pickup();
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

function wireUi() {
  const pause = document.getElementById('pauseMenu');
  const bigMapWrap = document.getElementById('mapOverlay');

  const setPaused = (v) => {
    game.paused = v;
    pause.classList.toggle('show', v);
    // iOS suspends the AudioContext when the app goes to the background and
    // does not hand it back on its own, so the world would come back silent.
    if (!v) audio.resume();
  };
  document.getElementById('pauseBtn').addEventListener('click', () => setPaused(!game.paused));
  document.getElementById('resumeBtn').addEventListener('click', () => setPaused(false));
  document.getElementById('mapBtn').addEventListener('click', () => {
    game.mapOpen = !game.mapOpen;
    bigMapWrap.classList.toggle('show', game.mapOpen);
    if (game.mapOpen) hud.drawBigMap(player, game);
  });
  bigMapWrap.addEventListener('click', () => {
    game.mapOpen = false;
    bigMapWrap.classList.remove('show');
  });
  document.getElementById('radioBtn').addEventListener('click', () => {
    audio.init();
    audio.resume();
    if (!audio.musicOn) {
      audio.musicOn = true;
      hud.showToast(audio.stationName());
    } else {
      hud.showToast(audio.nextStation());
    }
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
  bind('setSound', 'sound', (v) => { audio.enabled = v; });

  const sens = document.getElementById('setSens');
  sens.addEventListener('input', () => {
    controls.sensitivity = parseFloat(sens.value);
  });

  document.getElementById('respawnBtn').addEventListener('click', () => {
    setPaused(false);
    doRespawn();
  });

  const startAudio = () => {
    audio.init();
    audio.resume();
    window.removeEventListener('pointerdown', startAudio);
    window.removeEventListener('keydown', startAudio);
  };
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', startAudio);

  // Size from the canvas box, not window.inner*: in iOS standalone the document
  // is taller than the visual viewport by the status-bar inset.
  const fit = () => {
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
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  fit();
  // Pause on the way out, but through setPaused so the menu comes WITH it.
  // Setting game.paused directly stopped the world without showing anything to
  // tap, so coming back from the home screen looked like a hung game -- the
  // only way out was the pause button, which nobody presses on a frozen app.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true);
    else if (game.paused) pause.classList.add('show');
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

function frame(now) {
  requestAnimationFrame(frame);
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

  if (game.paused || game.mapOpen) {
    draw(now);
    return;
  }

  const input = controls.read();
  const look = controls.takeLook();

  if (game.dead) {
    game.deathT += dt;
    controls.takeTap();
    if (game.deathT > 2.6) doRespawn();
  } else {
    player.update(dt, input, look, controls, traffic, peds);
  }

  const p = player.position;
  const camDir = { x: p.x - player.camPos.x, z: p.z - player.camPos.z };
  const cl = Math.hypot(camDir.x, camDir.z) || 1;
  camDir.x /= cl; camDir.z /= cl;

  traffic.update(dt, p.x, p.z, camDir, player);
  peds.update(dt, p.x, p.z, player, traffic);
  updatePickups(dt);
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

  world.update(p.x, p.z, fps < 45 ? 1 : 2);

  player.applyCamera(camera);
  sun.position.set(p.x - 150, p.y + 230, p.z - 110);
  sun.target.position.set(p.x, p.y, p.z);
  sun.target.updateMatrixWorld();

  // audio state
  let siren = 0;
  for (const c of traffic.cars) {
    if (c.mode !== 'police') continue;
    const d = Math.sqrt(dist2(c.x, c.z, p.x, p.z));
    siren = Math.max(siren, clamp(1 - d / 130, 0, 1));
  }
  audio.update(dt, {
    inCar: !player.onFoot,
    speed: player.vehicle ? Math.abs(player.vehicle.vLong) : 0,
    throttle: input.gas ? 1 : 0,
    skid: player.vehicle ? player.vehicle.skid : 0,
    siren,
  });

  hud.update(dt, game, player, traffic);
  world.animate(dt, now / 1000);
  draw(now);
  autoQuality(dt);
}

function draw(now) {
  renderer.setRenderTarget(postfx.target);
  renderer.render(scene, camera);
  // capture before the post passes reset the counters
  sceneStats.calls = renderer.info.render.calls;
  sceneStats.tris = renderer.info.render.triangles;
  postfx.render(now / 1000);
  renderer.setRenderTarget(null);
}
const sceneStats = { calls: 0, tris: 0 };

// The phone this ships to can't be profiled from here, so the game measures
// itself and steps the quality down if it can't hold frame rate.
const TIERS = ['high', 'medium', 'low'];
let tierIdx = 0;
let slowFor = 0;
let qualityLocked = false;

function autoQuality(dt) {
  if (qualityLocked || tierIdx >= TIERS.length - 1) return;
  if (performance.now() - startedAt < 4000) return;
  if (window.__noAutoQuality) return;
  slowFor = fps < 40 ? slowFor + dt : 0;
  if (slowFor > 2.5) {
    slowFor = 0;
    applyQuality(TIERS[++tierIdx], false);
    hud.showToast(`Graphics: ${TIERS[tierIdx]}`);
  }
}

function applyQuality(q, manual) {
  if (manual) { qualityLocked = true; tierIdx = TIERS.indexOf(q); }
  game.settings.quality = q;
  postfx.setQuality(q);
  renderer.shadowMap.enabled = q !== 'low' && game.settings.shadows;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const cap = q === 'high' ? (isMobile ? 2 : 1.6) : q === 'medium' ? 1.5 : 1.15;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  renderer.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight, false);
  postfx.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight, renderer.getPixelRatio());
  for (const el of document.querySelectorAll('[data-quality]')) {
    el.classList.toggle('on', el.dataset.quality === q);
  }
}

boot().catch((e) => {
  loadMsg.textContent = 'Failed to start: ' + e.message;
  console.error(e);
});
