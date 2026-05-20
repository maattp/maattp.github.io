// Everything streaming down the tube toward the player: gate-walls (the
// obstacles), collectible orbs, and boost ramps. All three are object pools —
// fixed sets of meshes that wrap from behind the camera back out into the fog
// with fresh parameters, so steady-state play allocates nothing.
//
// Obstacles are partial-ring barriers (a torus with an arc cut out): you must
// rotate the craft into the gap before the ring reaches z=0. The gap shrinks
// as distance climbs. Orbs and ramps are single points on the wall you line up
// with. Collision is resolved the frame an item crosses the player plane.

import * as THREE from 'three';
import {
    ENTITY_RADIUS, SPAWN_Z, RECYCLE_Z, PLAYER_Z,
    HIT_ANGLE, COLLECT_ANGLE, RAMP_ANGLE,
    COL_OBSTACLE, COL_COLLECT, COL_RAMP,
} from './config.js';

const TWO_PI = Math.PI * 2;

function angDist(a, b) {
    let d = (a - b) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    return Math.abs(d);
}

// --- gate gap presets: [arc covered, gapHalfWidth] for easy/med/hard ---
const GAP_PRESETS = [
    { gapHalf: 1.15 },
    { gapHalf: 0.92 },
    { gapHalf: 0.70 },
    { gapHalf: 0.55 },
];

export class EntityField {
    constructor() {
        this.group = new THREE.Group();
        this.distance = 0;
        this.diff = 0;

        this._buildGates();
        this._buildOrbs();
        this._buildRamps();
        this.reset();
    }

    // ---------------- construction ----------------

    _buildGates() {
        this.gateSpacing = 38;
        this.gateCount = 13;
        this.gateSpan = this.gateSpacing * this.gateCount;

        // Pre-build one torus geometry per gap preset (swapping geometry on a
        // mesh is free; rebuilding it per wrap is not).
        this.gateGeos = GAP_PRESETS.map(({ gapHalf }) => {
            const arc = TWO_PI - 2 * gapHalf;
            const seg = Math.max(24, Math.round(96 * (arc / TWO_PI)));
            return new THREE.TorusGeometry(ENTITY_RADIUS, 0.5, 10, seg, arc);
        });

        this.gateMat = new THREE.MeshStandardMaterial({
            color: COL_OBSTACLE,
            emissive: new THREE.Color(COL_OBSTACLE),
            emissiveIntensity: 2.6,
            metalness: 0.3,
            roughness: 0.4,
        });

        this.gates = [];
        for (let i = 0; i < this.gateCount; i++) {
            const mesh = new THREE.Mesh(this.gateGeos[0], this.gateMat);
            mesh.frustumCulled = false;
            this.group.add(mesh);
            this.gates.push({ mesh, z: 0, prevZ: 0, gapCenter: 0, gapHalf: 1.15, consumed: false });
        }
    }

    _buildOrbs() {
        this.orbSpacing = 27;
        this.orbCount = 11;
        this.orbSpan = this.orbSpacing * this.orbCount;

        this.orbGeo = new THREE.IcosahedronGeometry(0.5, 0);
        this.orbMat = new THREE.MeshStandardMaterial({
            color: COL_COLLECT,
            emissive: new THREE.Color(COL_COLLECT),
            emissiveIntensity: 2.2,
            metalness: 0.6,
            roughness: 0.25,
            flatShading: true,
        });

        this.orbs = [];
        for (let i = 0; i < this.orbCount; i++) {
            const mesh = new THREE.Mesh(this.orbGeo, this.orbMat);
            mesh.frustumCulled = false;
            this.group.add(mesh);
            this.orbs.push({ mesh, z: 0, prevZ: 0, angle: 0, consumed: false });
        }
    }

    _buildRamps() {
        this.rampSpacing = 165;
        this.rampCount = 3;
        this.rampSpan = this.rampSpacing * this.rampCount;

        // A short, fat bright arc hugging the wall = a boost pad.
        this.rampGeo = new THREE.TorusGeometry(ENTITY_RADIUS, 0.62, 10, 28, 0.62);
        this.rampMat = new THREE.MeshStandardMaterial({
            color: COL_RAMP,
            emissive: new THREE.Color(COL_RAMP),
            emissiveIntensity: 3.2,
            metalness: 0.2,
            roughness: 0.4,
        });

        this.ramps = [];
        for (let i = 0; i < this.rampCount; i++) {
            const mesh = new THREE.Mesh(this.rampGeo, this.rampMat);
            mesh.frustumCulled = false;
            this.group.add(mesh);
            this.ramps.push({ mesh, z: 0, prevZ: 0, angle: 0, consumed: false });
        }
    }

    // ---------------- lifecycle ----------------

    reset() {
        this.distance = 0;
        this.diff = 0;
        // Give the player runway at the start: nearest gate well down the tube.
        for (let i = 0; i < this.gateCount; i++) {
            this._placeGate(this.gates[i], -120 - i * this.gateSpacing);
        }
        for (let i = 0; i < this.orbCount; i++) {
            this._placeOrb(this.orbs[i], -70 - i * this.orbSpacing);
        }
        for (let i = 0; i < this.rampCount; i++) {
            this._placeRamp(this.ramps[i], SPAWN_Z - i * this.rampSpacing);
        }
    }

    _gapPresetForDiff() {
        // bias toward harder presets as difficulty climbs
        const maxIdx = Math.min(GAP_PRESETS.length - 1, Math.floor(this.diff * 4));
        const idx = Math.floor(Math.random() * (maxIdx + 1));
        return GAP_PRESETS[idx];
    }

    _placeGate(g, z) {
        g.z = z;
        g.prevZ = z;
        g.consumed = false;
        const preset = this._gapPresetForDiff();
        const presetIdx = GAP_PRESETS.indexOf(preset);
        g.gapHalf = preset.gapHalf;
        g.gapCenter = Math.random() * TWO_PI;
        const geo = this.gateGeos[presetIdx];
        g.mesh.geometry = geo;
        // torus covers [rot, rot+arc]; centre the *gap* on gapCenter
        const arc = TWO_PI - 2 * g.gapHalf;
        g.mesh.rotation.z = g.gapCenter - arc / 2 - Math.PI;
        g.mesh.position.z = z;
    }

    _placeOrb(o, z) {
        o.z = z;
        o.prevZ = z;
        o.consumed = false;
        o.angle = Math.random() * TWO_PI;
        o.mesh.visible = true;
        this._orbXY(o);
        o.mesh.position.z = z;
    }

    _orbXY(o) {
        o.mesh.position.x = ENTITY_RADIUS * Math.cos(o.angle);
        o.mesh.position.y = ENTITY_RADIUS * Math.sin(o.angle);
    }

    _placeRamp(r, z) {
        r.z = z;
        r.prevZ = z;
        r.consumed = false;
        r.angle = Math.random() * TWO_PI;
        r.mesh.visible = true;
        // The arc is centred on the axis; its 0.62 rad span starts at angle 0,
        // so its midpoint sits at 0.31. Rotate to centre the pad on r.angle.
        r.mesh.position.set(0, 0, z);
        r.mesh.rotation.z = r.angle - 0.31;
    }

    // ---------------- per-frame ----------------

    update(dt, speed, playerAngle, api, time, collide) {
        this.distance += speed * dt;
        // difficulty saturates around ~9k distance
        this.diff = Math.min(1, this.distance / 9000);
        const move = speed * dt;

        // gates
        for (const g of this.gates) {
            g.prevZ = g.z;
            g.z += move;
            g.mesh.position.z = g.z;
            if (collide && !g.consumed && g.prevZ <= PLAYER_Z && g.z > PLAYER_Z) {
                g.consumed = true;
                const inGap = angDist(playerAngle, g.gapCenter) < (g.gapHalf - 0.05);
                if (!inGap) api.onHit();
            }
            if (g.z > RECYCLE_Z) this._placeGate(g, g.z - this.gateSpan);
        }

        // orbs (spin for sparkle)
        for (const o of this.orbs) {
            o.prevZ = o.z;
            o.z += move;
            o.mesh.position.z = o.z;
            o.mesh.rotation.x += dt * 2.0;
            o.mesh.rotation.y += dt * 2.6;
            if (collide && !o.consumed && o.prevZ <= PLAYER_Z && o.z > PLAYER_Z) {
                if (angDist(playerAngle, o.angle) < COLLECT_ANGLE) {
                    o.consumed = true;
                    o.mesh.visible = false;
                    api.onCollect();
                }
            }
            if (o.z > RECYCLE_Z) this._placeOrb(o, o.z - this.orbSpan);
        }

        // ramps
        for (const r of this.ramps) {
            r.prevZ = r.z;
            r.z += move;
            r.mesh.position.z = r.z;
            const pulse = 2.6 + Math.sin(time * 6 + r.z * 0.1) * 0.8;
            r.mesh.material.emissiveIntensity = pulse;
            if (collide && !r.consumed && r.prevZ <= PLAYER_Z && r.z > PLAYER_Z) {
                if (angDist(playerAngle, r.angle) < RAMP_ANGLE) {
                    r.consumed = true;
                    api.onBoost();
                }
            }
            if (r.z > RECYCLE_Z) this._placeRamp(r, r.z - this.rampSpan);
        }
    }
}
