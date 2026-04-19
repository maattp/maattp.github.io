import { DT, MAX_SUBSTEPS } from './config.js';
import { Terrain } from './terrain.js';
import { SPH } from './sph.js';
import { Erosion } from './erosion.js';
import { Renderer } from './renderer.js';
import { Controls } from './controls.js';
import { Audio } from './audio.js';

const canvas = document.getElementById('scene');
const heldValue = document.getElementById('heldValue');
const resetBtn = document.getElementById('resetBtn');
const muteBtn = document.getElementById('muteBtn');

let terrain, sph, erosion, renderer, controls, audio;

function init() {
    terrain = new Terrain();
    audio = new Audio();
    sph = new SPH(terrain);
    erosion = new Erosion(terrain, sph, audio);
    renderer = new Renderer(canvas, terrain, sph, erosion);
    controls = new Controls(canvas, renderer, terrain, audio);
}

init();

let accumulator = 0;
let lastTs = performance.now();
let heldSeconds = 0;
let heldStartReady = false;

function loop(ts) {
    let dtMs = ts - lastTs;
    if (dtMs > 100) dtMs = 100; // clamp on tab unfocus
    lastTs = ts;
    accumulator += dtMs / 1000;

    // Fixed physics timestep with capped substeps
    let substeps = 0;
    while (accumulator >= DT && substeps < MAX_SUBSTEPS) {
        sph.spawnFromSpring(DT);
        sph.step(DT);
        erosion.step(DT);
        accumulator -= DT;
        substeps++;
    }
    if (substeps === MAX_SUBSTEPS) accumulator = 0; // drop leftover if we're falling behind

    // Emit splash FX for high-velocity collisions (cheap proxy: debris just spawned)
    for (const b of erosion.breachEvents) {
        const force = b.kind === 'rock' ? 6 : 3;
        renderer.addSplash(b.x, b.y, force);
    }

    // Update HUD: count how long there's been significant flow reaching the ocean
    heldSeconds += dtMs / 1000;
    heldValue.textContent = formatDuration(heldSeconds);

    controls.update(dtMs);
    renderer.draw();
    requestAnimationFrame(loop);
}

function formatDuration(s) {
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    if (mm > 0) return `${mm}m${ss.toString().padStart(2, '0')}s`;
    return `${ss}s`;
}

function resize() {
    renderer.resize();
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

resetBtn.addEventListener('click', () => {
    terrain = new Terrain();
    sph = new SPH(terrain);
    erosion = new Erosion(terrain, sph, audio);
    renderer.terrain = terrain;
    renderer.sph = sph;
    renderer.erosion = erosion;
    controls.terrain = terrain;
    heldSeconds = 0;
    audio?.unlock();
});

muteBtn.addEventListener('click', () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
});

// Kick off
requestAnimationFrame((ts) => {
    lastTs = ts;
    requestAnimationFrame(loop);
});
