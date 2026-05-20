// The tunnel: a long cylinder seen from the inside, with a procedural neon
// grid drawn in the fragment shader. The grid scrolls via a uScroll uniform
// (advanced CPU-side by distance travelled) so the wall appears to rush past
// without moving any geometry. Rings (around the tube) plus longitudinal lines
// (down its length) give the F-Zero / Wipeout speedway read; a boost uniform
// hot-shifts the colour and brightness when a ramp fires.

import * as THREE from 'three';
import {
    TUBE_RADIUS, TUNNEL_LENGTH, COL_TUNNEL_A, COL_TUNNEL_B, COL_FOG,
} from './config.js';

const vert = /* glsl */`
    varying vec2 vUv;
    varying float vViewDepth;
    void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDepth = -mv.z;            // distance in front of the camera
        gl_Position = projectionMatrix * mv;
    }
`;

const frag = /* glsl */`
    precision highp float;
    varying vec2 vUv;
    varying float vViewDepth;

    uniform float uScroll;
    uniform float uBoost;        // 0..1
    uniform float uTime;
    uniform float uRingFreq;     // rings per unit length (baked from geometry)
    uniform float uLonCount;     // number of longitudinal lines
    uniform vec3  uColA;
    uniform vec3  uColB;
    uniform vec3  uFog;

    // crisp anti-aliased line mask from a 0..1 sawtooth coordinate
    float gridLine(float coord, float width) {
        float d = abs(fract(coord) - 0.5);          // 0 at line centre after offset
        float aa = fwidth(coord) * 1.4 + 1e-4;
        return 1.0 - smoothstep(width, width + aa, 0.5 - d);
    }

    void main() {
        // longitudinal lines around the circumference
        float lon = gridLine(vUv.x * uLonCount, 0.018);
        // rings down the length, scrolling toward the camera
        float ringCoord = vUv.y * uRingFreq - uScroll;
        float ring = gridLine(ringCoord, 0.012);

        // brighten a single ring periodically -> "gate" markers streaming by
        float gatePhase = floor(ringCoord);
        float gate = step(0.5, fract(gatePhase * 0.3333)) * step(fract(gatePhase * 0.3333), 0.55);
        ring *= 1.0 + gate * 1.6;

        float grid = clamp(lon + ring, 0.0, 2.2);

        // colour blends around the tube + slow hue drift; hot-shift on boost
        float mixA = 0.5 + 0.5 * sin(vUv.x * 6.2831 + uTime * 0.15);
        vec3 lineCol = mix(uColA, uColB, mixA);
        lineCol = mix(lineCol, vec3(1.0, 1.0, 0.95), uBoost * 0.6);

        float intensity = grid * (0.55 + uBoost * 0.9);
        vec3 col = lineCol * intensity;

        // faint base wall glow so the tube isn't pure black between lines
        col += uColA * 0.018;

        // fog into the distance hides the recycle seam at the far end
        float fog = clamp(vViewDepth / 320.0, 0.0, 1.0);
        fog = fog * fog;
        col = mix(col, uFog, fog);

        gl_FragColor = vec4(col, 1.0);
    }
`;

export class Tunnel {
    constructor() {
        // CylinderGeometry runs along Y by default; rotate so its axis is Z.
        const radial = 80;
        const geo = new THREE.CylinderGeometry(
            TUBE_RADIUS, TUBE_RADIUS, TUNNEL_LENGTH, radial, 1, true,
        );
        geo.rotateX(Math.PI / 2);

        // One ring every ~6 units of length.
        const ringFreq = TUNNEL_LENGTH / 6.0;

        this.mat = new THREE.ShaderMaterial({
            vertexShader: vert,
            fragmentShader: frag,
            side: THREE.BackSide,
            // fwidth() needs the derivatives extension on a WebGL1 fallback;
            // ignored (core) under WebGL2.
            extensions: { derivatives: true },
            uniforms: {
                uScroll: { value: 0 },
                uBoost: { value: 0 },
                uTime: { value: 0 },
                uRingFreq: { value: ringFreq },
                uLonCount: { value: 24 },
                uColA: { value: new THREE.Color(COL_TUNNEL_A) },
                uColB: { value: new THREE.Color(COL_TUNNEL_B) },
                uFog: { value: new THREE.Color(COL_FOG) },
            },
        });

        this.mesh = new THREE.Mesh(geo, this.mat);
        this.mesh.frustumCulled = false;
        this._scrollRate = ringFreq / TUNNEL_LENGTH; // rings advanced per world unit
    }

    // dist: total world units travelled this frame is folded into scroll so the
    // grid speed exactly tracks the obstacle stream.
    update(dt, speed, boost, time) {
        this.mat.uniforms.uScroll.value += speed * dt * this._scrollRate;
        this.mat.uniforms.uBoost.value = boost;
        this.mat.uniforms.uTime.value = time;
    }
}
