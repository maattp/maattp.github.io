// Camera controller: autonomous orbital drift + user drag/pinch input
// with smooth handoff back to drift after 3s of idle.
//
// Drift is a sum of sines at non-rational frequency ratios so the path
// never quite repeats. A slow constant-rate orbital term ensures we keep
// circling the network rather than oscillating around one face.
//
// Smoothing is applied to the underlying spherical state (theta, phi,
// distance) every frame regardless of mode — so transitions between
// drift and user input are inherently smooth without explicit blending.

import * as THREE from 'three';

const IDLE_HANDOFF_MS = 3000;

const DRIFT_AMPL_THETA = [0.55, 0.18];
const DRIFT_FREQ_THETA = [0.071, 0.113];
const DRIFT_AMPL_PHI   = [0.30, 0.11, 0.04];
const DRIFT_FREQ_PHI   = [0.083, 0.139, 0.201];
const DRIFT_AMPL_DIST  = [22, 8];
const DRIFT_FREQ_DIST  = [0.058, 0.097];
const DRIFT_ORBIT_RATE = 0.022;     // rad/sec — slow continuous spin

const SMOOTH_K_DRIFT = 0.06;
const SMOOTH_K_USER = 0.18;

const PHI_LIMIT = 1.35;             // ~77° — avoid pole flips
const DIST_MIN = 60;
const DIST_MAX = 360;

export class CortexCamera {
    constructor(threeCamera, canvas, opts = {}) {
        this.camera = threeCamera;
        this.canvas = canvas;
        this.opts = Object.assign({
            initialDistance: 220,
            initialTheta: 0.4,
            initialPhi: 0.15,
            target: new THREE.Vector3(0, 0, 0),
        }, opts);

        // Logical (target) spherical state — what drift / input drives.
        this.theta = this.opts.initialTheta;
        this.phi = this.opts.initialPhi;
        this.distance = this.opts.initialDistance;

        // Smoothed (rendered) spherical state — what the camera is actually at.
        this.smTheta = this.theta;
        this.smPhi = this.phi;
        this.smDistance = this.distance;

        // Drift bookkeeping
        this.mode = 'drift';
        this.driftStartMs = 0;
        this.driftBaseTheta = this.theta;
        this.driftBasePhi = this.phi;
        this.driftBaseDistance = this.distance;

        // Input bookkeeping
        this.lastInputMs = -Infinity;
        this.activePointers = new Map();   // pointerId -> {x, y}
        this.dragLastX = 0;
        this.dragLastY = 0;
        this.lastPinchDist = 0;

        // External click callback (set by main)
        this.onClickWorld = null;

        // Distinguish click from drag
        this._pointerDownAt = 0;
        this._pointerDownX = 0;
        this._pointerDownY = 0;
        this._movedDuringPointerDown = false;

        this._attach();
    }

    _attach() {
        const c = this.canvas;
        c.addEventListener('pointerdown', this._onPointerDown.bind(this));
        c.addEventListener('pointermove', this._onPointerMove.bind(this));
        c.addEventListener('pointerup', this._onPointerUp.bind(this));
        c.addEventListener('pointercancel', this._onPointerUp.bind(this));
        c.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    }

    _markInput(nowMs) {
        this.lastInputMs = nowMs;
        if (this.mode === 'drift') {
            this.mode = 'user';
        }
    }

    _onPointerDown(e) {
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.dragLastX = e.clientX;
        this.dragLastY = e.clientY;
        this._pointerDownAt = performance.now();
        this._pointerDownX = e.clientX;
        this._pointerDownY = e.clientY;
        this._movedDuringPointerDown = false;
        if (this.activePointers.size === 2) {
            this.lastPinchDist = this._currentPinchDist();
        }
        this._markInput(performance.now());
    }

    _onPointerMove(e) {
        if (!this.activePointers.has(e.pointerId)) return;
        const prev = this.activePointers.get(e.pointerId);
        prev.x = e.clientX; prev.y = e.clientY;

        if (this.activePointers.size === 1) {
            // Drag to orbit
            const dx = e.clientX - this.dragLastX;
            const dy = e.clientY - this.dragLastY;
            this.dragLastX = e.clientX;
            this.dragLastY = e.clientY;
            const dThetaPerPx = -0.005;
            const dPhiPerPx = 0.005;
            this.theta += dx * dThetaPerPx;
            this.phi += dy * dPhiPerPx;
            this.phi = Math.max(-PHI_LIMIT, Math.min(PHI_LIMIT, this.phi));
        } else if (this.activePointers.size === 2) {
            // Pinch to zoom
            const d = this._currentPinchDist();
            if (this.lastPinchDist > 0) {
                const ratio = this.lastPinchDist / d;
                this.distance *= ratio;
                this.distance = Math.max(DIST_MIN, Math.min(DIST_MAX, this.distance));
            }
            this.lastPinchDist = d;
        }

        // Track if pointer moved appreciably (for click detection)
        const totalDx = e.clientX - this._pointerDownX;
        const totalDy = e.clientY - this._pointerDownY;
        if (totalDx * totalDx + totalDy * totalDy > 36) {
            this._movedDuringPointerDown = true;
        }
        this._markInput(performance.now());
    }

    _onPointerUp(e) {
        const wasActive = this.activePointers.has(e.pointerId);
        this.activePointers.delete(e.pointerId);
        if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        if (this.activePointers.size < 2) this.lastPinchDist = 0;

        // Click detection — short, no drag
        if (wasActive && !this._movedDuringPointerDown
            && (performance.now() - this._pointerDownAt) < 300
            && this.activePointers.size === 0) {
            if (this.onClickWorld) this.onClickWorld(e.clientX, e.clientY);
        }
        this._markInput(performance.now());
    }

    _onWheel(e) {
        e.preventDefault();
        // deltaY > 0 = scroll down = zoom out (intuitive on trackpad/mouse)
        const factor = Math.exp(e.deltaY * 0.0014);
        this.distance *= factor;
        this.distance = Math.max(DIST_MIN, Math.min(DIST_MAX, this.distance));
        this._markInput(performance.now());
    }

    _currentPinchDist() {
        const pts = Array.from(this.activePointers.values());
        if (pts.length < 2) return 0;
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    update(nowMs) {
        // Mode handoff: 3s after last input with no pointers down, return to drift
        if (this.mode === 'user'
            && this.activePointers.size === 0
            && (nowMs - this.lastInputMs) > IDLE_HANDOFF_MS) {
            this.mode = 'drift';
            this.driftStartMs = nowMs;
            // Rebase drift so its t=0 value equals current logical state.
            // Subsequent drift values will then start from where the user
            // left off and gradually wander.
            this.driftBaseTheta = this.theta;
            this.driftBasePhi = this.phi;
            this.driftBaseDistance = this.distance;
        }

        if (this.mode === 'drift') {
            const t = (nowMs - this.driftStartMs) * 0.001;
            let th = this.driftBaseTheta + DRIFT_ORBIT_RATE * t;
            for (let k = 0; k < DRIFT_AMPL_THETA.length; k++) {
                th += DRIFT_AMPL_THETA[k] * Math.sin(t * DRIFT_FREQ_THETA[k] * Math.PI * 2);
            }
            let ph = this.driftBasePhi;
            for (let k = 0; k < DRIFT_AMPL_PHI.length; k++) {
                ph += DRIFT_AMPL_PHI[k] * Math.sin(t * DRIFT_FREQ_PHI[k] * Math.PI * 2 + k * 1.7);
            }
            ph = Math.max(-PHI_LIMIT, Math.min(PHI_LIMIT, ph));
            let d = this.driftBaseDistance;
            for (let k = 0; k < DRIFT_AMPL_DIST.length; k++) {
                d += DRIFT_AMPL_DIST[k] * Math.sin(t * DRIFT_FREQ_DIST[k] * Math.PI * 2 + k * 0.9);
            }
            d = Math.max(DIST_MIN, Math.min(DIST_MAX, d));

            this.theta = th;
            this.phi = ph;
            this.distance = d;
        }

        // Smooth toward logical state
        const k = this.mode === 'user' ? SMOOTH_K_USER : SMOOTH_K_DRIFT;
        this.smTheta += (this.theta - this.smTheta) * k;
        this.smPhi += (this.phi - this.smPhi) * k;
        this.smDistance += (this.distance - this.smDistance) * k;

        // Apply to camera
        const tgt = this.opts.target;
        const cosPhi = Math.cos(this.smPhi);
        const sinPhi = Math.sin(this.smPhi);
        const cosTh = Math.cos(this.smTheta);
        const sinTh = Math.sin(this.smTheta);
        this.camera.position.set(
            tgt.x + this.smDistance * cosPhi * sinTh,
            tgt.y + this.smDistance * sinPhi,
            tgt.z + this.smDistance * cosPhi * cosTh,
        );
        this.camera.lookAt(tgt);
    }

    getDistanceToTarget() {
        return this.smDistance;
    }
}
