// Three.js rendering layers for the cortex visualization.
//
// Three discrete layers, each with its own material, all blending into a
// shared HDR float framebuffer that postprocessing.js then bloom-passes:
//
//   1. Static synapse skeleton — faint subsampled line segments.
//      Always-on faint backbone so the architecture stays perceptible.
//   2. Neurons — instanced point sprites with per-neuron brightness.
//      Brightness is a Float32Array shared with simulation, flagged
//      needsUpdate every frame.
//   3. Pulses — instanced billboard strips. Each instance owns a
//      (srcPos, dstPos, tStart, tEnd, color) tuple; the vertex shader
//      computes the current head position from `now` and bills the strip
//      along the synapse direction. Self-culls degenerate instances.
//
// Plus a small additive fog billboard at each cluster centroid so the
// dense regions glow softly through the field.

import * as THREE from 'three';
import { CLUSTER_COUNT, MAX_ACTIVE_PULSES } from './simulation.js';

// ---------- Shaders ----------

const NEURON_VERT = /* glsl */`
attribute float aType;        // 0 = E, 1 = I
attribute float aBrightness;  // 0..N
attribute float aFlash;       // coincidence-flash 0..1

uniform float uPixelRatio;
uniform float uBaseSize;
uniform float uPeakSizeBoost;
uniform vec3 uColorE;
uniform vec3 uColorI;
uniform vec3 uColorFlash;

varying vec3 vColor;
varying float vIntensity;

void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    float dist = -mv.z;
    // Size attenuation: closer neurons render larger; brighter ones grow more
    float size = uBaseSize * (1.0 + aBrightness * uPeakSizeBoost);
    gl_PointSize = size * uPixelRatio * (220.0 / max(dist, 1.0));

    vec3 col = mix(uColorE, uColorI, aType);
    // Coincidence flash overrides toward white
    col = mix(col, uColorFlash, clamp(aFlash, 0.0, 1.0) * 0.85);

    // Intensity: low baseline glow, multiplied up sharply by brightness.
    // Squared brightness gives the spike a snappier flare.
    float baseline = 0.13;
    float spike = aBrightness * aBrightness * 5.5;
    vIntensity = baseline + spike + aFlash * 1.5;

    vColor = col;
}
`;

const NEURON_FRAG = /* glsl */`
varying vec3 vColor;
varying float vIntensity;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    // Soft round profile: bright core + halo
    float core = smoothstep(0.25, 0.0, r2);
    float halo = exp(-r2 * 12.0);
    float a = core * 0.85 + halo * 0.5;
    vec3 col = vColor * vIntensity * a;
    gl_FragColor = vec4(col, a);
}
`;

const SYNAPSE_VERT = /* glsl */`
attribute vec3 aColor;
varying vec3 vColor;

void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vColor = aColor;
}
`;

const SYNAPSE_FRAG = /* glsl */`
varying vec3 vColor;
uniform float uOpacity;

void main() {
    gl_FragColor = vec4(vColor * uOpacity, uOpacity);
}
`;

const PULSE_VERT = /* glsl */`
// Quad vertex: position.x ∈ [0,1] is along the trail (0=tail, 1=head),
// position.y ∈ [-0.5, 0.5] is perpendicular for billboard width.
attribute vec3 aSrc;
attribute vec3 aDst;
attribute vec2 aTime;       // tStart, tEnd in ms
attribute vec3 aColor;

uniform float uNow;          // ms
uniform float uTrailFraction;
uniform float uPulseRadius;
uniform vec3 uCameraPos;

varying float vAlongTrail;
varying float vCross;
varying vec3 vColor;
varying float vFade;

void main() {
    float duration = max(aTime.y - aTime.x, 1.0);
    float t = (uNow - aTime.x) / duration;

    if (t < 0.0 || t > 1.0) {
        // Cull: emit a degenerate vertex outside the clip cube
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vAlongTrail = 0.0;
        vCross = 0.0;
        vColor = vec3(0.0);
        vFade = 0.0;
        return;
    }

    vec3 head = mix(aSrc, aDst, t);
    vec3 dir = aDst - aSrc;
    float pathLen = length(dir);
    vec3 dirN = dir / max(pathLen, 0.001);
    float trailLen = pathLen * uTrailFraction;

    // Perpendicular for billboard, aimed at camera around the synapse axis
    vec3 toCam = normalize(uCameraPos - head);
    vec3 perp = cross(dirN, toCam);
    float perpLen = length(perp);
    if (perpLen < 0.001) {
        // Synapse direction nearly parallel to view; fallback perp
        perp = normalize(cross(dirN, vec3(0.0, 1.0, 0.0) + vec3(0.001)));
    } else {
        perp /= perpLen;
    }

    // Bring tail back from the head along the synapse line
    vec3 along = head - dirN * trailLen * (1.0 - position.x);
    vec3 worldPos = along + perp * uPulseRadius * position.y;

    vAlongTrail = position.x;
    vCross = position.y * 2.0;     // -1..1
    vColor = aColor;
    // Fade in/out at the very ends so pulses don't pop
    vFade = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.92, t);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

const PULSE_FRAG = /* glsl */`
varying float vAlongTrail;
varying float vCross;
varying vec3 vColor;
varying float vFade;

uniform float uIntensity;

void main() {
    // Cross-section: brightest along centerline
    float profile = exp(-vCross * vCross * 6.0);
    // Length: bright at head, fades exponentially to tail
    float trail = pow(vAlongTrail, 2.6);
    // Tighten the head into a sharp tip
    float head = smoothstep(0.85, 1.0, vAlongTrail);
    float i = (trail * 0.95 + head * 1.4) * profile * vFade * uIntensity;
    if (i < 0.002) discard;
    gl_FragColor = vec4(vColor * i, i * 0.85);
}
`;

const FOG_VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uPixelRatio;

void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    gl_PointSize = aSize * uPixelRatio * (300.0 / max(dist, 1.0));
    vColor = aColor;
}
`;

const FOG_FRAG = /* glsl */`
varying vec3 vColor;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    // Wide, soft falloff — this is a stand-in for raymarched volumetric fog
    float a = exp(-r * r * 2.5) * 0.06;
    gl_FragColor = vec4(vColor * a, a);
}
`;

// ---------- Renderer ----------

const COLOR_E_VEC = new THREE.Color(0.05, 0.78, 1.0);
const COLOR_I_VEC = new THREE.Color(1.0, 0.18, 0.58);

export class CortexRenderer {
    constructor(canvas, network, opts = {}) {
        this.canvas = canvas;
        this.network = network;
        this.opts = Object.assign({
            synapseSubsample: 0.22,    // fraction of synapses rendered as static skeleton
            synapseOpacity: 0.045,
            pulseTrailFraction: 0.28,
            pulseRadius: 0.55,
            pulseIntensity: 1.6,
            neuronBaseSize: 1.6,
            neuronPeakSizeBoost: 1.8,
            backgroundColor: 0x05060a,
        }, opts);

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: false,
            alpha: false,
            powerPreference: 'high-performance',
        });
        // Pixel ratio is owned by the caller (main.js sets it from the
        // hardware tier).
        this.renderer.setClearColor(this.opts.backgroundColor, 1);
        // We want HDR-ish accumulation for bloom; postprocessing.js sets up
        // the float render targets. Keep tone mapping off here so values
        // pass through linearly into the composer.
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.opts.backgroundColor);

        this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1000);
        this.camera.position.set(0, 0, 220);
        this.camera.lookAt(0, 0, 0);

        this._buildNeurons();
        this._buildSynapseSkeleton();
        this._buildPulses();
        this._buildClusterFog();
        this._buildBackgroundGradient();
    }

    _buildNeurons() {
        const N = this.network.n;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(this.network.positions, 3));
        const types = new Float32Array(N);
        for (let i = 0; i < N; i++) types[i] = this.network.types[i];
        geom.setAttribute('aType', new THREE.BufferAttribute(types, 1));
        // Brightness and coincidence-flash arrays are shared with the
        // simulation — we just flag needsUpdate each frame.
        this.brightnessAttr = new THREE.BufferAttribute(this.network.brightness, 1);
        this.brightnessAttr.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('aBrightness', this.brightnessAttr);

        this.flashAttr = new THREE.BufferAttribute(this.network.coincidenceFlash, 1);
        this.flashAttr.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('aFlash', this.flashAttr);

        const mat = new THREE.ShaderMaterial({
            vertexShader: NEURON_VERT,
            fragmentShader: NEURON_FRAG,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uBaseSize: { value: this.opts.neuronBaseSize },
                uPeakSizeBoost: { value: this.opts.neuronPeakSizeBoost },
                uColorE: { value: new THREE.Vector3().copy(COLOR_E_VEC) },
                uColorI: { value: new THREE.Vector3().copy(COLOR_I_VEC) },
                uColorFlash: { value: new THREE.Vector3(1.6, 1.6, 1.6) },
            },
        });

        this.neuronPoints = new THREE.Points(geom, mat);
        this.neuronPoints.frustumCulled = false;
        this.scene.add(this.neuronPoints);
        this.neuronMaterial = mat;
    }

    _buildSynapseSkeleton() {
        // Subsample synapses for the static layer so we don't drown in lines.
        const net = this.network;
        const subsample = this.opts.synapseSubsample;
        const totalSyn = net.synapseCount;
        const drawCount = Math.floor(totalSyn * subsample);

        const positions = new Float32Array(drawCount * 6);
        const colors = new Float32Array(drawCount * 6);

        // Walk synapses in order, accept ~`subsample` of them.
        let written = 0;
        const everyN = Math.max(1, Math.round(1 / subsample));
        // Simple deterministic stride; jitter the start so we don't always
        // hit the same neurons' first synapses.
        let cursor = 0;
        for (let i = 0; i < net.n && written < drawCount; i++) {
            const start = net.synOutStart[i];
            const end = net.synOutStart[i + 1];
            const sx = net.positions[i * 3 + 0];
            const sy = net.positions[i * 3 + 1];
            const sz = net.positions[i * 3 + 2];
            const t = net.types[i];
            const cR = t === 0 ? COLOR_E_VEC.r : COLOR_I_VEC.r;
            const cG = t === 0 ? COLOR_E_VEC.g : COLOR_I_VEC.g;
            const cB = t === 0 ? COLOR_E_VEC.b : COLOR_I_VEC.b;
            for (let s = start; s < end; s++) {
                if ((cursor++ % everyN) !== 0) continue;
                if (written >= drawCount) break;
                const dst = net.synDst[s];
                const o = written * 6;
                positions[o + 0] = sx;
                positions[o + 1] = sy;
                positions[o + 2] = sz;
                positions[o + 3] = net.positions[dst * 3 + 0];
                positions[o + 4] = net.positions[dst * 3 + 1];
                positions[o + 5] = net.positions[dst * 3 + 2];
                colors[o + 0] = cR; colors[o + 1] = cG; colors[o + 2] = cB;
                colors[o + 3] = cR; colors[o + 4] = cG; colors[o + 5] = cB;
                written++;
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, written * 6), 3));
        geom.setAttribute('aColor', new THREE.BufferAttribute(colors.subarray(0, written * 6), 3));

        const mat = new THREE.ShaderMaterial({
            vertexShader: SYNAPSE_VERT,
            fragmentShader: SYNAPSE_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uOpacity: { value: this.opts.synapseOpacity },
            },
        });

        this.synapseLines = new THREE.LineSegments(geom, mat);
        this.synapseLines.frustumCulled = false;
        this.scene.add(this.synapseLines);
        this.synapseMaterial = mat;
    }

    _buildPulses() {
        // Build a small quad strip with a few segments along its length,
        // so the trail has internal vertices the GPU can interpolate.
        const SEGMENTS = 8;
        const baseGeom = new THREE.BufferGeometry();
        const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
        const indices = [];
        for (let i = 0; i <= SEGMENTS; i++) {
            const x = i / SEGMENTS;
            positions[(i * 2 + 0) * 3 + 0] = x;
            positions[(i * 2 + 0) * 3 + 1] = -0.5;
            positions[(i * 2 + 0) * 3 + 2] = 0;
            positions[(i * 2 + 1) * 3 + 0] = x;
            positions[(i * 2 + 1) * 3 + 1] = 0.5;
            positions[(i * 2 + 1) * 3 + 2] = 0;
            if (i < SEGMENTS) {
                const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
                indices.push(a, b, c, b, d, c);
            }
        }
        baseGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        baseGeom.setIndex(indices);

        const instGeom = new THREE.InstancedBufferGeometry();
        instGeom.setAttribute('position', baseGeom.attributes.position);
        instGeom.setIndex(baseGeom.index);

        // One InstancedBufferAttribute per dynamic per-pulse field.
        // We allocate to the maximum capacity once; each frame we copy in
        // the alive subset and update geometry.instanceCount.
        this.pulseSrc = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTIVE_PULSES * 3), 3);
        this.pulseDst = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTIVE_PULSES * 3), 3);
        this.pulseTime = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTIVE_PULSES * 2), 2);
        this.pulseColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTIVE_PULSES * 3), 3);
        this.pulseSrc.setUsage(THREE.DynamicDrawUsage);
        this.pulseDst.setUsage(THREE.DynamicDrawUsage);
        this.pulseTime.setUsage(THREE.DynamicDrawUsage);
        this.pulseColor.setUsage(THREE.DynamicDrawUsage);
        instGeom.setAttribute('aSrc', this.pulseSrc);
        instGeom.setAttribute('aDst', this.pulseDst);
        instGeom.setAttribute('aTime', this.pulseTime);
        instGeom.setAttribute('aColor', this.pulseColor);
        instGeom.instanceCount = 0;

        const mat = new THREE.ShaderMaterial({
            vertexShader: PULSE_VERT,
            fragmentShader: PULSE_FRAG,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uNow: { value: 0 },
                uTrailFraction: { value: this.opts.pulseTrailFraction },
                uPulseRadius: { value: this.opts.pulseRadius },
                uIntensity: { value: this.opts.pulseIntensity },
                uCameraPos: { value: new THREE.Vector3() },
            },
        });

        this.pulseMesh = new THREE.Mesh(instGeom, mat);
        this.pulseMesh.frustumCulled = false;
        this.scene.add(this.pulseMesh);
        this.pulseMaterial = mat;
        this.pulseGeom = instGeom;
    }

    _buildClusterFog() {
        // One soft additive billboard per cluster. Cheap stand-in for
        // raymarched volumetric fog — gives the eye depth cues in the
        // densest regions without paying for a low-res raymarcher.
        const positions = new Float32Array(CLUSTER_COUNT * 3);
        const sizes = new Float32Array(CLUSTER_COUNT);
        const colors = new Float32Array(CLUSTER_COUNT * 3);
        // Tint each cluster slightly differently, biased toward cool/warm
        const palette = [
            [0.18, 0.30, 0.55],
            [0.42, 0.18, 0.50],
            [0.12, 0.40, 0.50],
            [0.50, 0.20, 0.35],
            [0.22, 0.34, 0.62],
            [0.36, 0.22, 0.46],
            [0.18, 0.42, 0.40],
        ];
        for (let c = 0; c < CLUSTER_COUNT; c++) {
            positions[c * 3 + 0] = this.network.clusterCenters[c * 3 + 0];
            positions[c * 3 + 1] = this.network.clusterCenters[c * 3 + 1];
            positions[c * 3 + 2] = this.network.clusterCenters[c * 3 + 2];
            sizes[c] = 95;
            const p = palette[c % palette.length];
            colors[c * 3 + 0] = p[0];
            colors[c * 3 + 1] = p[1];
            colors[c * 3 + 2] = p[2];
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.ShaderMaterial({
            vertexShader: FOG_VERT,
            fragmentShader: FOG_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uPixelRatio: { value: this.renderer.getPixelRatio() },
            },
        });
        this.fogPoints = new THREE.Points(geom, mat);
        this.fogPoints.frustumCulled = false;
        this.scene.add(this.fogPoints);
        this.fogMaterial = mat;
    }

    _buildBackgroundGradient() {
        // Subtle radial gradient sphere behind everything so pure-black
        // doesn't kill the bloom mood. Rendered as a giant inverted sphere
        // with a soft radial shader and depth disabled.
        const geom = new THREE.SphereGeometry(700, 32, 16);
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            uniforms: {},
            vertexShader: /* glsl */`
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                varying vec3 vDir;
                void main() {
                    // Brighter near the horizon-y midline, darker at poles
                    float band = 1.0 - abs(vDir.y);
                    vec3 cool = vec3(0.018, 0.022, 0.034) * (0.45 + 0.55 * band);
                    gl_FragColor = vec4(cool, 1.0);
                }
            `,
        });
        const sphere = new THREE.Mesh(geom, mat);
        sphere.renderOrder = -1000;
        this.scene.add(sphere);
        this.backgroundSphere = sphere;
    }

    // Per-frame hook: push simulation state into GPU buffers.
    syncFromSimulation() {
        // Neuron brightness and flash already share the same Float32Array
        // as the simulation; just flag for upload.
        this.brightnessAttr.needsUpdate = true;
        this.flashAttr.needsUpdate = true;

        // Rewrite pulse instance attributes from the simulation pool.
        // We compact alive pulses into the front of each instanced array.
        const stride = this.network.pulseStride;
        const src = this.network.pulseData;
        const alive = this.network.pulseAlive;

        const srcBuf = this.pulseSrc.array;
        const dstBuf = this.pulseDst.array;
        const timeBuf = this.pulseTime.array;
        const colBuf = this.pulseColor.array;

        let w = 0;
        for (let i = 0, n = alive.length; i < n; i++) {
            if (!alive[i]) continue;
            const o = i * stride;
            const wo3 = w * 3;
            const wo2 = w * 2;
            srcBuf[wo3 + 0] = src[o + 0];
            srcBuf[wo3 + 1] = src[o + 1];
            srcBuf[wo3 + 2] = src[o + 2];
            dstBuf[wo3 + 0] = src[o + 3];
            dstBuf[wo3 + 1] = src[o + 4];
            dstBuf[wo3 + 2] = src[o + 5];
            timeBuf[wo2 + 0] = src[o + 6];
            timeBuf[wo2 + 1] = src[o + 7];
            colBuf[wo3 + 0] = src[o + 8];
            colBuf[wo3 + 1] = src[o + 9];
            colBuf[wo3 + 2] = src[o + 10];
            w++;
            if (w >= MAX_ACTIVE_PULSES) break;
        }

        this.pulseGeom.instanceCount = w;
        // Upload only the prefix that changed
        this.pulseSrc.addUpdateRange(0, w * 3);   this.pulseSrc.needsUpdate = true;
        this.pulseDst.addUpdateRange(0, w * 3);   this.pulseDst.needsUpdate = true;
        this.pulseTime.addUpdateRange(0, w * 2);  this.pulseTime.needsUpdate = true;
        this.pulseColor.addUpdateRange(0, w * 3); this.pulseColor.needsUpdate = true;

        // Update pulse uniforms
        this.pulseMaterial.uniforms.uNow.value = this.network.simTimeMs;
        this.pulseMaterial.uniforms.uCameraPos.value.copy(this.camera.position);
    }

    setSize(width, height, pixelRatio) {
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.neuronMaterial.uniforms.uPixelRatio.value = pixelRatio;
        this.fogMaterial.uniforms.uPixelRatio.value = pixelRatio;
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
