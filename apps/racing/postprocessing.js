// Postprocessing: RenderPass -> UnrealBloom -> final grade (vignette +
// speed/boost chromatic aberration) -> OutputPass. Bloom is what makes the
// neon grid and emissive obstacles glow; the final pass adds a subtle lens
// vignette and a chromatic split that ramps up with speed and punches on boost,
// which reads as raw velocity.
//
// useHalfFloat is forced off on mobile: iOS WebKit has been flaky with
// HalfFloat colour attachments, and UnsignedByte is far more reliably
// renderable (matches the cortex app's hard-won default).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uAmount: { value: 0.0 },     // chromatic strength (speed + boost)
        uVignette: { value: 0.85 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uAmount;
        uniform float uVignette;
        void main() {
            vec2 dir = vUv - 0.5;
            float r2 = dot(dir, dir);
            // chromatic aberration grows toward the edges and with speed
            vec2 off = dir * (uAmount * (0.35 + r2 * 2.2));
            vec3 col;
            col.r = texture2D(tDiffuse, vUv + off).r;
            col.g = texture2D(tDiffuse, vUv).g;
            col.b = texture2D(tDiffuse, vUv - off).b;
            // vignette
            float vig = smoothstep(0.9, uVignette * 0.35, r2);
            col *= mix(0.55, 1.0, vig);
            gl_FragColor = vec4(col, 1.0);
        }
    `,
};

export class Post {
    constructor(renderer, scene, camera, opts = {}) {
        const w = opts.width || 1;
        const h = opts.height || 1;

        const rtType = opts.useHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
        const target = new THREE.WebGLRenderTarget(w, h, {
            type: rtType,
            samples: 0,
        });

        this.composer = new EffectComposer(renderer, target);
        this.composer.addPass(new RenderPass(scene, camera));

        this.bloom = new UnrealBloomPass(
            new THREE.Vector2(w, h),
            opts.bloomStrength ?? 0.9,
            opts.bloomRadius ?? 0.75,
            opts.bloomThreshold ?? 0.32,
        );
        this.composer.addPass(this.bloom);

        this.grade = new ShaderPass(GRADE_SHADER);
        this.composer.addPass(this.grade);

        this.composer.addPass(new OutputPass());
    }

    setSize(w, h) {
        this.composer.setSize(w, h);
        this.bloom.setSize(w, h);
    }

    // amount: 0..1 overall chromatic intensity from speed/boost
    setGrade(amount) {
        this.grade.uniforms.uAmount.value = amount * 0.02;
    }

    render() {
        this.composer.render();
    }
}
