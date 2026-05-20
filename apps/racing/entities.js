// Everything streaming down the tube toward the player: obstacles, collectible
// orbs, and boost ramps. All three are object pools — fixed sets of meshes that
// wrap from behind the camera back into the fog with fresh parameters, so
// steady-state play allocates nothing.
//
// Obstacles are small arc barriers stuck to the wall (a short torus arc): you
// rotate the craft AWAY from them to dodge. Early on they are tiny and sparse;
// as distance climbs they grow wider and spawn more often. Orbs and ramps are
// single points on the wall you line up with. Collision is resolved the frame
// an item crosses the player plane.

import * as THREE from 'three';
import {
    ENTITY_RADIUS, SPAWN_Z, RECYCLE_Z, PLAYER_Z,
    HIT_MARGIN, COLLECT_ANGLE, RAMP_ANGLE,
    COL_OBSTACLE, COL_COLLECT, COL_RAMP,
} from './config.js';

const TWO_PI = Math.PI * 2;

function angDist(a, b) {
    let d = (a - b) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    return Math.abs(d);
}

// Obstacle arc widths (full angular span, radians), smallest first. Early game
// only uses the small ones; bigger arcs unlock with difficulty.
const OBSTACLE_ARCS = [0.5, 0.72, 0.98, 1.28];

export class EntityField {
    constructor() {
        this.group = new THREE.Group();
        this.distance = 0;
        this.diff = 0;

        this._buildObstacles();
        this._buildOrbs();
        this._buildRamps();
        this.reset();
    }

    // ---------------- construction ----------------

    _buildObstacles() {
        this.obSpacing = 40;
        this.obCount = 14;
        this.obSpan = this.obSpacing * this.obCount;

        // Pre-build one torus arc per width (swapping geometry on a mesh is
        // free; rebuilding it per wrap is not).
        this.obGeos = OBSTACLE_ARCS.map((arc) => {
            const seg = Math.max(10, Math.round(40 * (arc / TWO_PI) * (TWO_PI / 0.5)));
            return new THREE.TorusGeometry(ENTITY_RADIUS, 0.42, 10, seg, arc);
        });

        this.obMat = new THREE.MeshStandardMaterial({
            color: COL_OBSTACLE,
            emissive: new THREE.Color(COL_OBSTACLE),
            emissiveIntensity: 2.6,
            metalness: 0.3,
            roughness: 0.4,
        });

        this.obstacles = [];
        for (let i = 0; i < this.obCount; i++) {
            const mesh = new THREE.Mesh(this.obGeos[0], this.obMat);
            mesh.frustumCulled = false;
            this.group.add(mesh);
            this.obstacles.push({ mesh, z: 0, prevZ: 0, center: 0, half: 0.25, active: false, consumed: false });
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
        // Give the player runway: nearest obstacle well down the tube, and force
        // the first couple of slots clear so the run never opens on a wall.
        for (let i = 0; i < this.obCount; i++) {
            this._placeObstacle(this.obstacles[i], -150 - i * this.obSpacing, i < 2);
        }
        for (let i = 0; i < this.orbCount; i++) {
            this._placeOrb(this.orbs[i], -70 - i * this.orbSpacing);
        }
        for (let i = 0; i < this.rampCount; i++) {
            this._placeRamp(this.ramps[i], SPAWN_Z - i * this.rampSpacing);
        }
    }

    _spawnChance() {
        // sparse at the start, busy later
        return Math.min(0.9, 0.3 + 0.55 * this.diff);
    }

    _arcIndexForDiff() {
        // only small arcs early; wider ones unlock as difficulty climbs
        const maxIdx = Math.min(OBSTACLE_ARCS.length - 1, Math.floor(this.diff * 4));
        return Math.floor(Math.random() * (maxIdx + 1));
    }

    _placeObstacle(o, z, forceEmpty = false) {
        o.z = z;
        o.prevZ = z;
        o.consumed = false;
        o.active = !forceEmpty && Math.random() < this._spawnChance();
        o.mesh.visible = o.active;
        if (o.active) {
            const idx = this._arcIndexForDiff();
            const arc = OBSTACLE_ARCS[idx];
            o.half = arc / 2;
            o.center = Math.random() * TWO_PI;
            o.mesh.geometry = this.obGeos[idx];
            // torus arc spans local [0, arc]; centre it on o.center
            o.mesh.rotation.z = o.center - arc / 2;
        }
        o.mesh.position.z = z;
    }

    _placeOrb(o, z) {
        o.z = z;
        o.prevZ = z;
        o.consumed = false;
        o.angle = Math.random() * TWO_PI;
        o.mesh.visible = true;
        o.mesh.position.x = ENTITY_RADIUS * Math.cos(o.angle);
        o.mesh.position.y = ENTITY_RADIUS * Math.sin(o.angle);
        o.mesh.position.z = z;
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
        // difficulty saturates around ~12k distance (gentle early ramp)
        this.diff = Math.min(1, this.distance / 12000);
        const move = speed * dt;

        // obstacles
        for (const o of this.obstacles) {
            o.prevZ = o.z;
            o.z += move;
            o.mesh.position.z = o.z;
            if (collide && o.active && !o.consumed && o.prevZ <= PLAYER_Z && o.z > PLAYER_Z) {
                o.consumed = true;
                if (angDist(playerAngle, o.center) < o.half + HIT_MARGIN) api.onHit();
            }
            if (o.z > RECYCLE_Z) this._placeObstacle(o, o.z - this.obSpan);
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
