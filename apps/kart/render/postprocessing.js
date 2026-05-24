// Postprocessing: RenderPass -> gentle UnrealBloom -> grade (soft vignette +
// boost chromatic split) -> OutputPass. For the bright cartoon look the bloom is
// kept low with a high threshold so only highlights (sky, white kerbs, sparks)
// glow rather than the whole frame washing out. Chromatic aberration stays at
// zero until you boost, where it punches to sell speed.
//
// useHalfFloat is forced off on mobile (iOS WebKit is flaky with HalfFloat
// colour attachments); UnsignedByte renders reliably everywhere.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uAmount: { value: 0.0 },
        uVignette: { value: 0.9 },
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
            vec2 off = dir * (uAmount * (0.3 + r2 * 2.0));
            vec3 col;
            col.r = texture2D(tDiffuse, vUv + off).r;
            col.g = texture2D(tDiffuse, vUv).g;
            col.b = texture2D(tDiffuse, vUv - off).b;
            float vig = smoothstep(0.95, uVignette * 0.45, r2);
            col *= mix(0.78, 1.0, vig);
            gl_FragColor = vec4(col, 1.0);
        }
    `,
};

export class Post {
    constructor(renderer, scene, camera, opts = {}) {
        const w = opts.width || 1;
        const h = opts.height || 1;

        const rtType = opts.useHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
        const target = new THREE.WebGLRenderTarget(w, h, { type: rtType, samples: 0 });

        this.composer = new EffectComposer(renderer, target);
        this.composer.addPass(new RenderPass(scene, camera));

        this.bloom = new UnrealBloomPass(
            new THREE.Vector2(w, h),
            opts.bloomStrength ?? 0.35,
            opts.bloomRadius ?? 0.6,
            opts.bloomThreshold ?? 0.82,
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

    // amount: 0..1 chromatic intensity (driven by boost)
    setGrade(amount) {
        this.grade.uniforms.uAmount.value = amount * 0.016;
    }

    render() {
        this.composer.render();
    }
}
