// Chase camera: sits behind the kart, follows with a little lag, looks slightly
// down, and on boost widens its FOV and pulls back a touch to sell speed. It is
// driven off the interpolated render state, and smooths in real (frame) time, so
// it never feeds back into the simulation.

import * as THREE from 'three';
import { TUNING as T } from '../config.js';

export class ChaseCamera {
    constructor(camera) {
        this.camera = camera;
        this._pos = new THREE.Vector3();
        this._look = new THREE.Vector3();
        this._fov = T.camFovBase;
        this._init = false;
    }

    // r: interpolated render state. boost: 0..1. dt: real seconds since last frame.
    update(r, boost, dt) {
        const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
        const dist = T.camDistance + T.camBoostPullback * boost;

        // desired camera position: behind + above the kart
        const dx = r.x - fx * dist;
        const dz = r.z - fz * dist;
        const dy = T.camHeight;

        // desired look target: ahead of and slightly above the kart
        const lx = r.x + fx * T.camLookAhead;
        const lz = r.z + fz * T.camLookAhead;
        const ly = T.camLookHeight;

        if (!this._init) {
            this._pos.set(dx, dy, dz);
            this._look.set(lx, ly, lz);
            this._init = true;
        } else {
            const k = Math.min(1, T.camFollowLag * dt);
            this._pos.x += (dx - this._pos.x) * k;
            this._pos.y += (dy - this._pos.y) * k;
            this._pos.z += (dz - this._pos.z) * k;
            this._look.x += (lx - this._look.x) * k;
            this._look.y += (ly - this._look.y) * k;
            this._look.z += (lz - this._look.z) * k;
        }

        this.camera.position.copy(this._pos);
        this.camera.lookAt(this._look);

        const targetFov = T.camFovBase + (T.camFovBoost - T.camFovBase) * boost;
        this._fov += (targetFov - this._fov) * Math.min(1, T.camFovLag * dt);
        if (Math.abs(this.camera.fov - this._fov) > 0.02) {
            this.camera.fov = this._fov;
            this.camera.updateProjectionMatrix();
        }
    }

    reset() {
        this._init = false;
    }
}
