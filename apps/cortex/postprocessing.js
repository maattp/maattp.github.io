// Postprocessing pipeline:
//   (external) render scene → sceneRT (HDR + depth)
//   composer:  TexturePass(sceneRT) → DoF → Bloom → Final → Output
//
// We render the scene to our own sceneRT (HDR + depth) and feed that into
// the composer via TexturePass. This is the only way to safely sample
// scene depth from a downstream pass — if we let EffectComposer own the
// depth-equipped RT it would ping-pong it as both read and write target,
// triggering a "feedback loop" GL_INVALID_OPERATION the moment any pass
// (e.g. DoF) bound the depth texture as a uniform.
//
// Bloom threshold sits above baseline neuron glow so only spikes /
// pulses bloom — that's what makes them feel hot rather than fuzzy.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DOF_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1000.0 },
        uFocusDistance: { value: 220 },
        uFocusRange: { value: 60 },
        uMaxBlur: { value: 1.6 },     // pixels at peak blur
        uResolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform float uFocusDistance;
        uniform float uFocusRange;
        uniform float uMaxBlur;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float linearizeDepth(float d) {
            float z = d * 2.0 - 1.0;
            return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
        }

        void main() {
            float depth = texture2D(tDepth, vUv).x;
            float linDepth = linearizeDepth(depth);
            float coc = clamp(abs(linDepth - uFocusDistance) / uFocusRange, 0.0, 1.0);
            float blurPx = coc * uMaxBlur;
            vec2 texel = blurPx / uResolution;

            // 7-tap soft disk: center + ring of 6
            vec3 sum = texture2D(tDiffuse, vUv).rgb * 1.0;
            float wsum = 1.0;
            const float TAU = 6.2831853;
            for (int k = 0; k < 6; k++) {
                float a = float(k) / 6.0 * TAU;
                vec2 off = vec2(cos(a), sin(a)) * texel;
                sum += texture2D(tDiffuse, vUv + off).rgb;
                wsum += 1.0;
            }
            gl_FragColor = vec4(sum / wsum, 1.0);
        }
    `,
};

const FINAL_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCAStrength: { value: 0.0030 },
        uCABloomGate: { value: 0.6 },
        uGrainStrength: { value: 0.040 },
        uVignetteStrength: { value: 0.55 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec2 uResolution;
        uniform float uCAStrength;
        uniform float uCABloomGate;
        uniform float uGrainStrength;
        uniform float uVignetteStrength;
        varying vec2 vUv;

        float hash(vec2 p) {
            p = fract(p * vec2(443.897, 441.423));
            p += dot(p, p.yx + 19.19);
            return fract((p.x + p.y) * p.x);
        }

        void main() {
            vec3 center = texture2D(tDiffuse, vUv).rgb;
            float lum = dot(center, vec3(0.299, 0.587, 0.114));
            float gate = smoothstep(uCABloomGate, uCABloomGate + 0.6, lum);

            vec2 dir = vUv - 0.5;
            float r = length(dir);
            vec2 caOff = normalize(dir + vec2(0.0001)) * uCAStrength * (0.4 + r) * gate;
            float rCh = texture2D(tDiffuse, vUv + caOff).r;
            float gCh = center.g;
            float bCh = texture2D(tDiffuse, vUv - caOff).b;
            vec3 col = vec3(rCh, gCh, bCh);

            float vig = 1.0 - smoothstep(0.55, 1.0, r) * uVignetteStrength;
            col *= vig;

            float n = hash(vUv * uResolution + vec2(uTime * 60.0));
            col += (n - 0.5) * uGrainStrength;

            col = col / (1.0 + col * 0.5);

            gl_FragColor = vec4(col, 1.0);
        }
    `,
};

export class CortexPostprocessor {
    constructor(renderer, scene, camera, opts = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.opts = Object.assign({
            bloomStrength: 1.05,
            bloomRadius: 0.85,
            bloomThreshold: 0.42,
            enableDoF: true,
            enableBloom: true,
        }, opts);

        const size = renderer.getDrawingBufferSize(new THREE.Vector2());

        // Our own scene RT — owns the depth texture. Composer never touches this.
        const dt = new THREE.DepthTexture(size.x, size.y);
        dt.type = THREE.UnsignedShortType;
        this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
            type: THREE.HalfFloatType,
            depthBuffer: true,
            depthTexture: dt,
        });
        this.depthTexture = dt;

        // Composer RTs — HDR but no depth attachment, so no feedback risk.
        const composerRT = new THREE.WebGLRenderTarget(size.x, size.y, {
            type: THREE.HalfFloatType,
            depthBuffer: false,
        });
        this.composer = new EffectComposer(renderer, composerRT);
        this.composer.setSize(size.x, size.y);

        // Pass 1: bring scene color into the composer pipeline
        this.scenePass = new TexturePass(this.sceneRT.texture);
        this.composer.addPass(this.scenePass);

        // Pass 2: DoF — reads color from readBuffer (= scenePass output),
        // depth from sceneRT.depthTexture as a separate uniform.
        if (this.opts.enableDoF) {
            this.dofPass = new ShaderPass(DOF_SHADER);
            this.dofPass.uniforms.tDepth.value = dt;
            this.dofPass.uniforms.uCameraNear.value = camera.near;
            this.dofPass.uniforms.uCameraFar.value = camera.far;
            this.dofPass.uniforms.uResolution.value.copy(size);
            this.composer.addPass(this.dofPass);
        }

        // Pass 3: bloom
        if (this.opts.enableBloom) {
            this.bloomPass = new UnrealBloomPass(
                size,
                this.opts.bloomStrength,
                this.opts.bloomRadius,
                this.opts.bloomThreshold,
            );
            this.composer.addPass(this.bloomPass);
        }

        // Pass 4: final composite (CA + grain + vignette + tone curve)
        this.finalPass = new ShaderPass(FINAL_SHADER);
        this.finalPass.uniforms.uResolution.value.copy(size);
        this.composer.addPass(this.finalPass);

        // Pass 5: output (sRGB conversion)
        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
    }

    setSize(width, height) {
        this.composer.setSize(width, height);
        this.sceneRT.setSize(width, height);
        if (this.dofPass) this.dofPass.uniforms.uResolution.value.set(width, height);
        this.finalPass.uniforms.uResolution.value.set(width, height);
        if (this.bloomPass) this.bloomPass.setSize(width, height);
    }

    setFocusDistance(d) {
        if (this.dofPass) this.dofPass.uniforms.uFocusDistance.value = d;
    }

    render(timeMs) {
        // Step 1: render scene into our depth-equipped RT
        const prevTarget = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.sceneRT);
        this.renderer.clear(true, true, true);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(prevTarget);

        // Step 2: run the composer (uses sceneRT.texture as input)
        this.finalPass.uniforms.uTime.value = timeMs * 0.001;
        this.composer.render();
    }
}
