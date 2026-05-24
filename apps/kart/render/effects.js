// Particle + decal juice driven off the kart's render state:
//   - drift smoke   : puffs off the rear wheels while drifting, tinted to the
//                     current charge stage (so the slide colour-codes in-world)
//   - skid marks    : dark strips laid on the asphalt while drifting (ring-buffer
//                     InstancedMesh, one draw call)
//   - sparks        : bright bursts on each stage-up and a trickle while boosting
//
// All cosmetic. Buffer-update patterns mirror the racing app's streak system.

import * as THREE from 'three';
import { COLORS, VISUALS } from '../config.js';

export class Effects {
    constructor(scene) {
        this.group = new THREE.Group();
        scene.add(this.group);
        this.smoke = new Particles(VISUALS.smokeMax, THREE.NormalBlending, 1.0);
        this.sparks = new Particles(VISUALS.sparkMax, THREE.AdditiveBlending, 0.55);
        this.group.add(this.smoke.points);
        this.group.add(this.sparks.points);
        this._skid = makeSkid();
        this.group.add(this._skid.mesh);
        this._skidDist = 0;
        this._prevStage = 0;
    }

    reset() {
        this.smoke.clear();
        this.sparks.clear();
        this._skid.clear();
        this._skidDist = 0;
        this._prevStage = 0;
    }

    // fx: { x, z, heading, drifting, driftStage, boost, boostStage, speed, dx, dz }
    update(dt, fx) {
        const fwdX = Math.sin(fx.heading), fwdZ = Math.cos(fx.heading);
        const rgtX = Math.cos(fx.heading), rgtZ = -Math.sin(fx.heading);
        // rear-wheel world positions
        const rear = (side) => ({
            x: fx.x + rgtX * side * 0.98 + fwdX * -1.05,
            z: fx.z + rgtZ * side * 0.98 + fwdZ * -1.05,
        });

        // ---- drift smoke + skid ----
        if (fx.drifting) {
            const tint = new THREE.Color(0xdfe6ee);
            if (fx.driftStage > 0) tint.lerp(new THREE.Color(COLORS.driftStage[fx.driftStage - 1]), 0.55);
            for (const side of [-1, 1]) {
                const p = rear(side);
                if (Math.random() < 0.9) this.smoke.spawn(p.x, 0.25, p.z, tint, 0.6 + Math.random() * 0.5, 1.1 + fx.driftStage * 0.3);
            }
            // lay skid marks every fixed distance travelled
            this._skidDist += (fx.speed || 0) * dt;
            if (this._skidDist > 0.6) {
                this._skidDist = 0;
                for (const side of [-1, 1]) {
                    const p = rear(side);
                    this._skid.drop(p.x, p.z, fx.heading);
                }
            }
        }

        // ---- stage-up spark burst ----
        if (fx.driftStage > this._prevStage && fx.driftStage > 0) {
            const c = new THREE.Color(COLORS.driftStage[fx.driftStage - 1]);
            for (const side of [-1, 1]) {
                const p = rear(side);
                for (let i = 0; i < 10; i++) this.sparks.spawn(p.x, 0.4, p.z, c, 0.35, 0.5, 7);
            }
        }
        this._prevStage = fx.driftStage;

        // ---- boost trail sparks ----
        if (fx.boost > 0.1 && Math.random() < fx.boost) {
            const c = new THREE.Color(COLORS.driftStage[Math.max(0, fx.boostStage - 1)]);
            const ex = { x: fx.x + fwdX * -1.7, z: fx.z + fwdZ * -1.7 };
            this.sparks.spawn(ex.x, 0.6, ex.z, c, 0.3, 0.45, 5);
        }

        this.smoke.update(dt);
        this.sparks.update(dt);
    }
}

// Generic GPU point pool with soft round sprites and per-particle colour/alpha.
class Particles {
    constructor(max, blending, sizeScale) {
        this.max = max;
        this.pos = new Float32Array(max * 3);
        this.col = new Float32Array(max * 3);
        this.data = new Float32Array(max * 2); // [size, lifeFrac]
        this.vel = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.maxLife = new Float32Array(max);
        this.cursor = 0;

        const geo = new THREE.BufferGeometry();
        this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
        this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
        this.aData = new THREE.BufferAttribute(this.data, 2).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', this.aPos);
        geo.setAttribute('color', this.aCol);
        geo.setAttribute('aData', this.aData);

        this.mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending,
            uniforms: { uScale: { value: sizeScale } },
            vertexShader: /* glsl */`
                attribute vec3 color;
                attribute vec2 aData;
                uniform float uScale;
                varying vec3 vCol;
                varying float vAlpha;
                void main() {
                    vCol = color;
                    vAlpha = aData.y;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    float d = max(-mv.z, 1.0);
                    gl_PointSize = aData.x * uScale * (320.0 / d);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */`
                varying vec3 vCol;
                varying float vAlpha;
                void main() {
                    vec2 p = gl_PointCoord - 0.5;
                    float a = smoothstep(0.5, 0.05, length(p));
                    if (a <= 0.001) discard;
                    gl_FragColor = vec4(vCol, a * vAlpha);
                }
            `,
        });
        this.points = new THREE.Points(geo, this.mat);
        this.points.frustumCulled = false;
    }

    spawn(x, y, z, color, life, size, speed = 1.2) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.max;
        this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
        this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
        const ang = Math.random() * Math.PI * 2;
        this.vel[i * 3] = Math.cos(ang) * speed * 0.5;
        this.vel[i * 3 + 1] = speed * (0.6 + Math.random() * 0.8);
        this.vel[i * 3 + 2] = Math.sin(ang) * speed * 0.5;
        this.life[i] = this.maxLife[i] = life;
        this.data[i * 2] = size;
        this.data[i * 2 + 1] = 1;
    }

    update(dt) {
        for (let i = 0; i < this.max; i++) {
            if (this.life[i] <= 0) { this.data[i * 2 + 1] = 0; continue; }
            this.life[i] -= dt;
            const f = Math.max(0, this.life[i] / this.maxLife[i]);
            this.pos[i * 3] += this.vel[i * 3] * dt;
            this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
            this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
            this.vel[i * 3] *= 0.92; this.vel[i * 3 + 1] *= 0.92; this.vel[i * 3 + 2] *= 0.92;
            this.data[i * 2] += dt * 1.5;     // grow
            this.data[i * 2 + 1] = f;          // fade
        }
        this.aPos.needsUpdate = true;
        this.aCol.needsUpdate = true;
        this.aData.needsUpdate = true;
    }

    clear() {
        this.life.fill(0);
        this.data.fill(0);
        this.aData.needsUpdate = true;
    }
}

function makeSkid() {
    const max = VISUALS.skidMax;
    const geo = new THREE.PlaneGeometry(0.34, 0.8);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
        color: 0x1a1a1f, transparent: true, opacity: 0.34, depthWrite: false,
    });
    const inst = new THREE.InstancedMesh(geo, mat, max);
    inst.position.y = 0.03;
    inst.frustumCulled = false;
    const dummy = new THREE.Object3D();
    // hide all initially
    dummy.scale.setScalar(0);
    for (let i = 0; i < max; i++) inst.setMatrixAt(i, dummy.matrix);
    inst.instanceMatrix.needsUpdate = true;

    let cursor = 0;
    return {
        mesh: inst,
        drop(x, z, heading) {
            dummy.position.set(x, 0, z);
            dummy.rotation.set(0, heading, 0);
            dummy.scale.setScalar(1);
            dummy.updateMatrix();
            inst.setMatrixAt(cursor, dummy.matrix);
            inst.instanceMatrix.needsUpdate = true;
            cursor = (cursor + 1) % max;
        },
        clear() {
            dummy.scale.setScalar(0); dummy.updateMatrix();
            for (let i = 0; i < max; i++) inst.setMatrixAt(i, dummy.matrix);
            inst.instanceMatrix.needsUpdate = true;
            cursor = 0;
        },
    };
}
