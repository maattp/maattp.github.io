// Tunnel racer — entry point and game loop.
//
// Stack: WebGL2 + Three.js. The craft hugs the inside of an endless tube; the
// whole world rotates about the tube axis so the craft stays pinned to the
// bottom of the screen while you spin around to dodge ring-gates, grab orbs,
// and slam boost ramps. Steering is device tilt (gyroscope), with keyboard /
// drag fallbacks for desktop.
//
// Single source of truth for velocity is `speed`: cruise speed grows with
// distance, a boost ramp slams it to BOOST_SPEED, a crash multiplies it down,
// and it always eases back toward cruise. Everything visual (FOV punch,
// chromatic grade, streak stretch, tunnel hue) is driven off how far above
// cruise we currently are.

import * as THREE from 'three';
import {
    SPEED_START, SPEED_MAX, SPEED_RAMP_DIST, BOOST_SPEED, HIT_SLOWDOWN,
    FOV_BASE, FOV_BOOST, MAX_ANG_VEL, STEER_SMOOTH,
    START_SHIELDS, INVULN_TIME, CRAFT_RADIUS, CAM_RISE, CAM_BACK,
} from './config.js';
import { Stage } from './scene.js';
import { Post } from './postprocessing.js';
import { Input } from './input.js';
import { Hud } from './hud.js';

// ---------- hardware tiering ----------

function detectTier() {
    const ua = navigator.userAgent || '';
    const isMobile = /iPhone|iPad|iPod|Android/.test(ua);
    const cores = navigator.hardwareConcurrency || 4;
    const dpr = window.devicePixelRatio || 1;
    const mem = navigator.deviceMemory || 4;

    let rendererStr = '';
    try {
        const tmp = document.createElement('canvas').getContext('webgl2');
        if (tmp) {
            const ext = tmp.getExtension('WEBGL_debug_renderer_info');
            if (ext) rendererStr = tmp.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
            const lose = tmp.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
    } catch (e) { /* ignore */ }
    const lowGpu = /SwiftShader|Mali|Adreno 3|Adreno 4|PowerVR/i.test(rendererStr);

    if (isMobile || cores < 4 || mem < 3 || lowGpu) {
        return {
            tier: 'low',
            pixelRatio: Math.min(dpr, 1.5),
            antialias: false,
            streakCount: 200,
            bloomStrength: 0.8,
            useHalfFloat: false,
        };
    }
    if (cores < 8) {
        return {
            tier: 'medium',
            pixelRatio: Math.min(dpr, 1.75),
            antialias: true,
            streakCount: 340,
            bloomStrength: 0.95,
            useHalfFloat: false,
        };
    }
    return {
        tier: 'high',
        pixelRatio: Math.min(dpr, 2),
        antialias: true,
        streakCount: 440,
        bloomStrength: 1.05,
        useHalfFloat: true,
    };
}

function showFatal(msg) {
    const el = document.getElementById('err');
    if (el) {
        el.style.display = 'block';
        el.textContent = 'racing error: ' + msg;
    }
    console.error('[racing]', msg);
}

// ---------- init ----------

const canvas = document.getElementById('game');
const tier = detectTier();

let stage, post, input, hud;
try {
    stage = new Stage(canvas, tier);
    post = new Post(stage.renderer, stage.scene, stage.camera, {
        width: 1, height: 1,
        bloomStrength: tier.bloomStrength,
        bloomRadius: 0.8,
        bloomThreshold: 0.3,
        useHalfFloat: tier.useHalfFloat,
    });
    input = new Input();
    hud = new Hud();
} catch (e) {
    showFatal((e && e.message ? e.message : String(e)) + ' [tier=' + tier.tier + ']');
    throw e;
}

// ---------- resize ----------

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === 0 || h === 0) { requestAnimationFrame(resize); return; }
    const dpr = stage.renderer.getPixelRatio();
    stage.setSize(w, h);
    post.setSize(Math.round(w * dpr), Math.round(h * dpr));
}
window.addEventListener('resize', resize);
resize();

// ---------- game state ----------

const STATE = { READY: 0, PLAYING: 1, DEAD: 2 };
const game = {
    state: STATE.READY,
    p: 0,            // craft angle around the tube
    steer: 0,        // smoothed -1..1
    speed: SPEED_START,
    distance: 0,
    orbs: 0,
    shields: START_SHIELDS,
    invuln: 0,
    score: 0,
    best: loadBest(),
    shakeT: 0,
    shakeAmp: 0,
};

function loadBest() {
    try { return parseInt(localStorage.getItem('racing.best') || '0', 10) || 0; }
    catch (e) { return 0; }
}
function saveBest(v) {
    try { localStorage.setItem('racing.best', String(v)); } catch (e) { /* ignore */ }
}

function cruiseSpeed() {
    const t = Math.min(1, game.distance / SPEED_RAMP_DIST);
    return SPEED_START + (SPEED_MAX - SPEED_START) * t;
}

function resetRun() {
    game.p = 0;
    game.steer = 0;
    game.speed = SPEED_START;
    game.distance = 0;
    game.orbs = 0;
    game.shields = START_SHIELDS;
    game.invuln = 0;
    game.score = 0;
    game.shakeT = 0;
    stage.entities.reset();
    stage.player.reset();
    stage.setSteerRotation(game.p);
    hud.setShields(game.shields, START_SHIELDS);
    hud.setScore(0, game.best);
    hud.setSpeed(0);
}

// collision callbacks handed to the entity field
const api = {
    onHit() {
        if (game.invuln > 0) return;
        game.shields -= 1;
        game.invuln = INVULN_TIME;
        game.speed *= HIT_SLOWDOWN;
        game.shakeT = 0.35; game.shakeAmp = 0.5;
        hud.setShields(Math.max(0, game.shields), START_SHIELDS);
        if (game.shields <= 0) die();
    },
    onCollect() {
        game.orbs += 1;
    },
    onBoost() {
        game.speed = Math.max(game.speed, BOOST_SPEED);
        game.shakeT = 0.5; game.shakeAmp = 0.7;
        hud.flashBoost();
    },
};

function die() {
    game.state = STATE.DEAD;
    game.score = computeScore();
    if (game.score > game.best) { game.best = game.score; saveBest(game.best); }
    hud.showOver(game.score, game.best, game.orbs);
}

function computeScore() {
    return Math.floor(game.distance) + game.orbs * 100;
}

// ---------- start / restart ----------

async function start() {
    if (game.state === STATE.PLAYING) return;
    const ok = await input.enableMotion();
    if (!ok && !input.hasMotion) hud.setHintNoMotion();
    input.calibrate();
    resetRun();
    game.state = STATE.PLAYING;
    hud.showPlaying();
}

document.getElementById('screen-start').addEventListener('click', start);
document.getElementById('screen-over').addEventListener('click', () => {
    if (game.state !== STATE.DEAD) return;
    input.calibrate();
    resetRun();
    game.state = STATE.PLAYING;
    hud.showPlaying();
});

// ---------- loop ----------

const cameraBase = new THREE.Vector3(0, -CRAFT_RADIUS + CAM_RISE, CAM_BACK);
let lastMs = performance.now();
let timeS = 0;
let loopFatal = false;

function tick(nowMs) {
    if (loopFatal) return;
    requestAnimationFrame(tick);

    const dt = Math.min(0.05, (nowMs - lastMs) / 1000);
    lastMs = nowMs;
    timeS += dt;

    try {
        step(dt);
        post.render();
    } catch (e) {
        loopFatal = true;
        showFatal('frame: ' + (e && e.message ? e.message : String(e)));
        throw e;
    }
}

function step(dt) {
    const playing = game.state === STATE.PLAYING;

    // ---- steering ----
    if (playing) {
        const target = input.sample();
        game.steer += (target - game.steer) * Math.min(1, dt * STEER_SMOOTH);
        game.p += game.steer * MAX_ANG_VEL * dt;
    } else if (game.state === STATE.READY) {
        game.steer *= 0.9;
        game.p += 0.25 * dt; // gentle showcase spin
    }
    stage.setSteerRotation(game.p);

    // ---- speed ----
    let cruise;
    if (game.state === STATE.READY) cruise = SPEED_START * 0.5;
    else if (game.state === STATE.DEAD) cruise = 0;
    else cruise = cruiseSpeed();
    // ease speed toward cruise (this is how boost bleeds off and crashes recover)
    game.speed += (cruise - game.speed) * Math.min(1, dt * 1.1);

    if (playing) {
        game.distance += game.speed * dt;
        if (game.invuln > 0) game.invuln = Math.max(0, game.invuln - dt);
    }

    // how far above cruise we are -> drives all the speed-feel visuals
    const headroom = Math.max(1, BOOST_SPEED - cruise);
    const boostAmt = playing ? Math.max(0, Math.min(1, (game.speed - cruise) / headroom)) : 0;
    const speed01 = Math.min(1, game.speed / SPEED_MAX);

    // ---- world update ----
    stage.tunnel.update(dt, game.speed, boostAmt, timeS);
    stage.streaks.update(dt, game.speed, boostAmt);
    stage.entities.update(dt, game.speed, game.p, api, timeS, playing);

    stage.player.update(dt, {
        steer: game.steer,
        boost: boostAmt,
        speed01,
        invuln: game.invuln,
        time: timeS,
        alive: playing,
    });

    // ---- camera (fov punch + shake) ----
    stage.setFov(FOV_BASE + (FOV_BOOST - FOV_BASE) * boostAmt);
    stage.camera.position.copy(cameraBase);
    if (game.shakeT > 0) {
        game.shakeT = Math.max(0, game.shakeT - dt);
        const a = game.shakeT * game.shakeAmp;
        stage.camera.position.x += (Math.random() - 0.5) * a;
        stage.camera.position.y += (Math.random() - 0.5) * a;
    }

    // ---- grade ----
    post.setGrade(0.25 * speed01 + 0.75 * boostAmt);

    // ---- HUD ----
    if (playing) {
        const sc = computeScore();
        hud.setScore(sc, Math.max(game.best, sc));
        hud.setSpeed((game.speed - SPEED_START) / (BOOST_SPEED - SPEED_START));
    }
}

// reflect any saved best on the start screen before the first run
hud.showStart();
hud.setShields(START_SHIELDS, START_SHIELDS);
hud.setScore(0, game.best);

requestAnimationFrame(tick);
