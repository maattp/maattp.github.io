// Cortex — neural network visualization
//
// Stack: WebGL2 + Three.js, CPU-side leaky integrate-and-fire simulation,
// GPU-instanced rendering with per-frame attribute uploads.
//
// Why CPU sim instead of GPGPU ping-pong textures: 16k neurons at 200Hz
// is ~3M updates/sec, well within JS budget on a modern laptop. The
// synapse delivery — push each spike's outgoing weight into scattered
// future timesteps of a delay ring buffer — is exactly the kind of
// variable-fanout scatter-write pattern that GPGPU is bad at. Doing it
// on CPU lets us keep the pipeline straightforward and spend the GPU
// budget on rendering quality instead.
//
// Why not WebGPU: Safari/WebKit support is uneven as of early 2026, and
// this site runs as an iOS PWA. WebGL2 is the broader path.
//
// Loop topology: rAF → fixed-step simulation catch-up → state sync →
// camera update → composer render. Postprocessing handles bloom, DoF,
// chromatic aberration, grain, vignette.

import * as THREE from 'three';
import { Network, SIM_DT_MS } from './simulation.js';
import { CortexRenderer } from './rendering.js';
import { CortexPostprocessor } from './postprocessing.js';
import { CortexCamera } from './camera.js';

// ---------- Hardware tier detection ----------

function detectTier() {
    const ua = navigator.userAgent || '';
    const isMobile = /iPhone|iPad|iPod|Android/.test(ua);
    const cores = navigator.hardwareConcurrency || 4;
    const dpr = window.devicePixelRatio || 1;
    const memHint = navigator.deviceMemory || 4;

    // Try to read renderer string for finer tiering
    let rendererStr = '';
    try {
        const tmp = document.createElement('canvas').getContext('webgl2');
        if (tmp) {
            const ext = tmp.getExtension('WEBGL_debug_renderer_info');
            if (ext) {
                rendererStr = tmp.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
            }
        }
    } catch (e) { /* ignore */ }
    const lowGpu = /SwiftShader|Mali|Adreno 3|Adreno 4|PowerVR/i.test(rendererStr);

    if (isMobile || cores < 4 || memHint < 3 || lowGpu) {
        return {
            tier: 'low',
            neuronCount: 6144,
            enableDoF: false,
            enableBloom: true,
            bloomStrength: 0.85,
            pixelRatio: Math.min(dpr, 1.5),
            synapseSubsample: 0.14,
        };
    }
    if (cores < 8) {
        return {
            tier: 'medium',
            neuronCount: 12288,
            enableDoF: true,
            enableBloom: true,
            bloomStrength: 1.0,
            pixelRatio: Math.min(dpr, 1.75),
            synapseSubsample: 0.20,
        };
    }
    return {
        tier: 'high',
        neuronCount: 16384,
        enableDoF: true,
        enableBloom: true,
        bloomStrength: 1.05,
        pixelRatio: Math.min(dpr, 2),
        synapseSubsample: 0.22,
    };
}

// ---------- Init ----------

const canvas = document.getElementById('cortex');
const tier = detectTier();

const network = new Network(tier.neuronCount);
const renderer = new CortexRenderer(canvas, network, {
    synapseSubsample: tier.synapseSubsample,
});
renderer.renderer.setPixelRatio(tier.pixelRatio);

const post = new CortexPostprocessor(renderer.renderer, renderer.scene, renderer.camera, {
    bloomStrength: tier.bloomStrength,
    bloomRadius: 0.85,
    bloomThreshold: 0.42,
    enableDoF: tier.enableDoF,
    enableBloom: tier.enableBloom,
});

const camCtl = new CortexCamera(renderer.camera, canvas, {
    initialDistance: 230,
    initialTheta: 0.4,
    initialPhi: 0.18,
});

// ---------- Resize ----------

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = renderer.renderer.getPixelRatio();
    renderer.setSize(w, h, dpr);
    post.setSize(w * dpr, h * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------- Click → cascade ----------

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmpVec = new THREE.Vector3();
const tmpRel = new THREE.Vector3();

camCtl.onClickWorld = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, renderer.camera);

    // Find the neuron closest to the ray (3D point-to-line distance)
    const origin = ray.ray.origin;
    const dir = ray.ray.direction;
    const positions = network.positions;
    let bestIdx = -1;
    let bestD2 = Infinity;
    let bestT = 0;
    for (let i = 0; i < network.n; i++) {
        const px = positions[i * 3 + 0];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        const rx = px - origin.x;
        const ry = py - origin.y;
        const rz = pz - origin.z;
        const t = rx * dir.x + ry * dir.y + rz * dir.z;
        if (t < 0) continue;
        const closestX = origin.x + dir.x * t;
        const closestY = origin.y + dir.y * t;
        const closestZ = origin.z + dir.z * t;
        const dx = px - closestX, dy = py - closestY, dz = pz - closestZ;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) {
            bestD2 = d2;
            bestIdx = i;
            bestT = t;
        }
    }

    if (bestIdx >= 0) {
        const px = network.positions[bestIdx * 3 + 0];
        const py = network.positions[bestIdx * 3 + 1];
        const pz = network.positions[bestIdx * 3 + 2];
        network.stimulate(px, py, pz);
    }
};

// ---------- Loop ----------

const TARGET_SIM_HZ = 1000 / SIM_DT_MS;     // 200 Hz
const MAX_SIM_STEPS_PER_FRAME = 8;          // catch-up cap; avoid spirals on tab-resume
let simAccumulatorMs = 0;
let lastFrameMs = performance.now();
let firstFrameDone = false;

// FPS monitor for live degradation
let fpsSamples = [];
let fpsCheckedAt = 0;
let degradeTriggered = false;

function tick(nowMs) {
    requestAnimationFrame(tick);

    const dtMs = Math.min(100, nowMs - lastFrameMs); // clamp big gaps (tab switch)
    lastFrameMs = nowMs;
    simAccumulatorMs += dtMs;

    // Fixed-step simulation catch-up
    let stepsThisFrame = 0;
    while (simAccumulatorMs >= SIM_DT_MS && stepsThisFrame < MAX_SIM_STEPS_PER_FRAME) {
        network.step();
        simAccumulatorMs -= SIM_DT_MS;
        stepsThisFrame++;
    }
    if (simAccumulatorMs > SIM_DT_MS * MAX_SIM_STEPS_PER_FRAME) {
        // Hard reset accumulator if we fell way behind
        simAccumulatorMs = 0;
    }

    // Camera + state sync + render
    camCtl.update(nowMs);
    renderer.syncFromSimulation();
    // Keep DoF focus on the network's near edge so the front feels sharp
    if (post.dofPass) post.setFocusDistance(camCtl.getDistanceToTarget() * 0.75);
    post.render(nowMs);

    // FPS-based live degradation
    if (firstFrameDone && !degradeTriggered) {
        fpsSamples.push(dtMs);
        if (fpsSamples.length > 90) fpsSamples.shift();
        if (nowMs - fpsCheckedAt > 2000 && fpsSamples.length >= 60) {
            const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
            const fps = 1000 / avg;
            fpsCheckedAt = nowMs;
            if (fps < 38 && post.bloomPass) {
                // Soften bloom or kill DoF — the cheapest meaningful drop
                if (post.dofPass) {
                    const idx = post.composer.passes.indexOf(post.dofPass);
                    if (idx >= 0) post.composer.passes.splice(idx, 1);
                    post.dofPass = null;
                    fpsSamples = [];
                } else if (post.bloomPass.strength > 0.6) {
                    post.bloomPass.strength *= 0.7;
                    fpsSamples = [];
                } else {
                    degradeTriggered = true;
                }
            }
        }
    }
    firstFrameDone = true;
}

// Prime a brief warmup so the network has visible activity by frame 1
for (let i = 0; i < 80; i++) network.step();

requestAnimationFrame(tick);
