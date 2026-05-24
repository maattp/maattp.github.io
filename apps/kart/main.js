// Kart racer — Milestone 1 entry point.
//
// Architecture (built for multiplayer later, single-player now):
//   - FIXED-TIMESTEP simulation at 60Hz, fully decoupled from rendering. The
//     renderer interpolates between the last two sim states. This is the part
//     multiplayer prediction/reconciliation will depend on, so it is in place
//     from day one even though there's only one local kart.
//   - The kart sim (simulation/kart.js) is a PURE (state, input) -> state
//     function with no rendering/input-device code, so it can run on a remote
//     host unchanged.
//   - render/* is all Three.js; input/* is the only place that knows about
//     keys/touches. main.js wires them together and owns the race/lap rules.

import { stepKart, createKartState } from './simulation/kart.js';
import { createTrack } from './simulation/track.js';
import { Stage } from './render/scene.js';
import { Post } from './render/postprocessing.js';
import { buildTrackView } from './render/trackView.js';
import { buildProps } from './render/props.js';
import { KartView } from './render/kartView.js';
import { Effects } from './render/effects.js';
import { ChaseCamera } from './render/chaseCamera.js';
import { Input } from './input/input.js';
import { Hud } from './hud.js';
import { TUNING as T } from './config.js';

const STEP = 1 / 60;
const MAX_BOOST_BONUS = Math.max(...T.boostStageBonus);
const SLIP_REF = 15;            // lateral speed that reads as "full slide" (visual only)
const SPEED_DISPLAY_SCALE = 3;  // raw units/s -> punchier HUD number (display only)

function showFatal(msg) {
    const el = document.getElementById('err');
    if (el) { el.style.display = 'block'; el.textContent = 'kart error: ' + msg; }
    console.error('[kart]', msg);
}

function detectTier() {
    const ua = navigator.userAgent || '';
    const isMobile = /iPhone|iPad|iPod|Android/.test(ua);
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 4;
    if (isMobile || cores < 4) {
        return {
            pixelRatio: Math.min(dpr, 1.5), antialias: false,
            shadowMap: 1024, bloomStrength: 0.32, useHalfFloat: false,
        };
    }
    return {
        pixelRatio: Math.min(dpr, 2), antialias: true,
        shadowMap: 2048, bloomStrength: 0.38, useHalfFloat: true,
    };
}

// ---------------------------------------------------------------- boot
const canvas = document.getElementById('game');
const tier = detectTier();
let stage, post, kartView, effects, chase, hud, input, track;
try {
    track = createTrack();
    stage = new Stage(canvas, tier);
    stage.scene.add(buildTrackView(track));
    stage.scene.add(buildProps());
    kartView = new KartView();
    stage.scene.add(kartView.group);
    effects = new Effects(stage.scene);
    chase = new ChaseCamera(stage.camera);
    post = new Post(stage.renderer, stage.scene, stage.camera, {
        width: 1, height: 1,
        bloomStrength: tier.bloomStrength,
        useHalfFloat: tier.useHalfFloat,
    });
    hud = new Hud();
    input = new Input({
        steerZone: document.getElementById('steer-zone'),
        brake: document.getElementById('btn-brake'),
        drift: document.getElementById('btn-drift'),
    });
} catch (e) {
    showFatal((e && e.message) ? e.message : String(e));
    throw e;
}

// ---------------------------------------------------------------- resize
function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === 0 || h === 0) { requestAnimationFrame(resize); return; }
    stage.setSize(w, h);
    const dpr = stage.renderer.getPixelRatio();
    post.setSize(Math.round(w * dpr), Math.round(h * dpr));
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- game state
const STATE = { READY: 0, COUNTDOWN: 1, RACING: 2, FINISHED: 3 };
const game = {
    state: STATE.READY,
    prev: null,        // sim state at start of the last fixed step (for interpolation)
    curr: null,        // sim state after the last fixed step
    countdown: 0,
    raceTime: 0,
    lapStart: 0,
    lapsCompleted: 0,
    lapTimes: [],
    prevProgress: 0,
    passedHalf: false,
    shake: 0,          // decaying camera-shake kick (stage-ups)
    lastStage: 0,      // for detecting drift-charge stage-ups
};

function freshSim() {
    const s = createKartState(track.startPose);
    game.prev = s;
    game.curr = { ...s };
}

function resetRace() {
    freshSim();
    game.raceTime = 0;
    game.lapStart = 0;
    game.lapsCompleted = 0;
    game.lapTimes = [];
    game.prevProgress = track.progressAt(game.curr.x, game.curr.z);
    game.passedHalf = false;
    game.shake = 0;
    game.lastStage = 0;
    chase.reset();
    effects.reset();
    hud.setLap(1, T.totalLaps);
    hud.setLapTime(0);
    hud.setSpeed(0);
    hud.setDrift(0, 0, false);
}

// ---------------------------------------------------------------- wake lock
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* ignore */ }
}
function releaseWakeLock() {
    try { wakeLock && wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && game.state === STATE.RACING) requestWakeLock();
});

// ---------------------------------------------------------------- start / restart
function startRace() {
    resetRace();
    game.state = STATE.COUNTDOWN;
    game.countdown = T.countdownSeconds;
    hud.showPlaying();
    hud.setCountdown(String(T.countdownSeconds));
    requestWakeLock();
}

document.getElementById('btn-start').addEventListener('click', startRace);
document.getElementById('btn-restart').addEventListener('click', startRace);

// ---------------------------------------------------------------- lap tracking
function trackLaps() {
    const p = track.progressAt(game.curr.x, game.curr.z);
    if (p > 0.45 && p < 0.55) game.passedHalf = true;
    // forward crossing of the start line (high progress -> low progress)
    if (game.passedHalf && game.prevProgress > 0.7 && p < 0.3) {
        const lapTime = game.raceTime - game.lapStart;
        game.lapTimes.push(lapTime);
        game.lapStart = game.raceTime;
        game.lapsCompleted++;
        game.passedHalf = false;
        if (game.lapsCompleted >= T.totalLaps) {
            finishRace();
        } else {
            hud.setLap(game.lapsCompleted + 1, T.totalLaps);
        }
    }
    game.prevProgress = p;
}

function finishRace() {
    game.state = STATE.FINISHED;
    releaseWakeLock();
    hud.showResults(game.lapTimes, game.lapTimes.reduce((a, b) => a + b, 0));
}

// ---------------------------------------------------------------- fixed-step sim
const NEUTRAL = { steer: 0, accelerate: false, brake: false, drift: false };

function simStep() {
    // Held at the start line until GO: don't advance physics during READY/COUNTDOWN
    // so the kart can't roll down the slope before the race begins.
    if (game.state !== STATE.RACING && game.state !== STATE.FINISHED) return;
    const cmd = game.state === STATE.RACING ? input.sample() : NEUTRAL;
    game.prev = game.curr;
    game.curr = stepKart(game.curr, cmd, STEP, track);
    if (game.state === STATE.RACING) {
        game.raceTime += STEP;
        trackLaps();
    }
}

// ---------------------------------------------------------------- render helpers
function angleLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
}

function interpolated(alpha) {
    const p = game.prev, c = game.curr;
    // feel scalars come from the authoritative latest state
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const rx = Math.cos(c.heading), rz = -Math.sin(c.heading);
    const vLat = c.vx * rx + c.vz * rz;
    const boost = clamp((c.forwardSpeed - T.topSpeed) / (MAX_BOOST_BONUS || 1), 0, 1);
    return {
        x: p.x + (c.x - p.x) * alpha,
        y: p.y + (c.y - p.y) * alpha,
        z: p.z + (c.z - p.z) * alpha,
        heading: angleLerp(p.heading, c.heading, alpha),
        slip: clamp(vLat / SLIP_REF, -1, 1),
        steer: c.steer,
        speed: c.forwardSpeed,
        drifting: c.drifting,
        airborne: c.airborne,
        boost,
        driftStage: c.driftStage,
        boostStage: c.boostStage,
    };
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
let acc = 0;
let loopFatal = false;

function frame(now) {
    if (loopFatal) return;
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // avoid spiral of death after a tab stall

    try {
        // countdown advances in real time
        if (game.state === STATE.COUNTDOWN) {
            game.countdown -= dt;
            if (game.countdown > 0) {
                hud.setCountdown(String(Math.ceil(game.countdown)));
            } else if (game.countdown > -0.7) {
                hud.setCountdown('GO!');
            } else {
                hud.setCountdown(null);
                game.state = STATE.RACING;
                game.lapStart = game.raceTime;
            }
        }

        // fixed-timestep simulation
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 5) { simStep(); acc -= STEP; steps++; }
        if (steps === 5) acc = 0; // dropped frames: don't let the backlog explode

        // render with interpolation
        const r = interpolated(acc / STEP);
        kartView.update(r, dt);
        effects.update(dt, r);
        chase.update(r, r.boost, dt);
        stage.setSunFocus(r.x, r.y, r.z);

        // camera shake: continuous on boost + a kick on each charge stage-up
        if (game.curr.driftStage > game.lastStage) game.shake = T.camShakeStageUp;
        game.lastStage = game.curr.driftStage;
        game.shake = Math.max(0, game.shake - dt * 2.2);
        const shakeAmp = game.shake + r.boost * T.camShakeBoost;
        if (shakeAmp > 0.001) {
            stage.camera.position.x += (Math.random() - 0.5) * shakeAmp;
            stage.camera.position.y += (Math.random() - 0.5) * shakeAmp;
        }

        post.setGrade(r.boost);

        // HUD (live values from latest sim state)
        if (game.state === STATE.RACING) {
            hud.setSpeed(Math.max(0, game.curr.forwardSpeed) * SPEED_DISPLAY_SCALE);
            const stage = game.curr.driftStage;
            const charge = game.curr.driftCharge / T.driftStageTimes[T.driftStageTimes.length - 1];
            hud.setDrift(charge, stage, game.curr.boostTimer > 0);
            hud.setLapTime(game.raceTime - game.lapStart);
        }

        post.render();
    } catch (e) {
        loopFatal = true;
        showFatal('frame: ' + ((e && e.message) ? e.message : String(e)));
        throw e;
    }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// initial state
freshSim();
game.prevProgress = track.progressAt(game.curr.x, game.curr.z);
hud.showStart();
requestAnimationFrame(frame);
