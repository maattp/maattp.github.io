// Speed streaks: a cloud of additive points near the tunnel wall that rush
// toward the camera. Their on-screen smear comes from a size that grows with
// speed plus the bloom pass; on boost they brighten and stretch. Cheap enough
// for mobile (a few hundred points, one buffer update for Z per frame).

import * as THREE from 'three';
import { TUBE_RADIUS, SPAWN_Z, RECYCLE_Z } from './config.js';

export class Streaks {
    constructor(count = 320) {
        this.count = count;
        const pos = new Float32Array(count * 3);
        const seed = new Float32Array(count); // per-point brightness jitter
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = TUBE_RADIUS * (0.55 + Math.random() * 0.42);
            pos[i * 3 + 0] = Math.cos(a) * r;
            pos[i * 3 + 1] = Math.sin(a) * r;
            pos[i * 3 + 2] = SPAWN_Z + Math.random() * (RECYCLE_Z - SPAWN_Z);
            seed[i] = 0.5 + Math.random() * 0.5;
        }
        const geo = new THREE.BufferGeometry();
        this.posAttr = new THREE.BufferAttribute(pos, 3);
        this.posAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', this.posAttr);
        geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));

        this.mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uSize: { value: 2.0 },
                uBoost: { value: 0 },
                uColor: { value: new THREE.Color(0x9fe8ff) },
            },
            vertexShader: /* glsl */`
                attribute float seed;
                uniform float uSize;
                uniform float uBoost;
                varying float vSeed;
                void main() {
                    vSeed = seed;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    // closer points are bigger; boost inflates everything
                    float d = max(-mv.z, 1.0);
                    gl_PointSize = (uSize * (1.0 + uBoost * 2.2)) * (260.0 / d) * seed;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uColor;
                uniform float uBoost;
                varying float vSeed;
                void main() {
                    vec2 p = gl_PointCoord - 0.5;
                    float d = length(p);
                    float a = smoothstep(0.5, 0.0, d);
                    vec3 c = mix(uColor, vec3(1.0), uBoost * 0.6);
                    gl_FragColor = vec4(c, a * (0.35 + uBoost * 0.5) * vSeed);
                }
            `,
        });

        this.points = new THREE.Points(geo, this.mat);
        this.points.frustumCulled = false;
        this._arr = pos;
    }

    update(dt, speed, boost) {
        const move = speed * dt;
        const arr = this._arr;
        const span = RECYCLE_Z - SPAWN_Z;
        for (let i = 0; i < this.count; i++) {
            let z = arr[i * 3 + 2] + move;
            if (z > RECYCLE_Z) z -= span;
            arr[i * 3 + 2] = z;
        }
        this.posAttr.needsUpdate = true;
        this.mat.uniforms.uBoost.value = boost;
    }
}
