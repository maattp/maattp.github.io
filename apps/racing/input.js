// Steering input. Primary control is device tilt (the phone's left/right roll,
// i.e. the `gamma` orientation angle). On the first start tap we request motion
// permission (required on iOS 13+), then calibrate so "level" is wherever the
// player is holding the phone. Keyboard (arrows / A-D) and pointer drag are
// kept as a desktop fallback so the game is playable and testable without a
// gyroscope.
//
// Exposes `steer`: a smoothed -1..1 value the game maps to angular velocity.

import { TILT_RANGE_DEG } from './config.js';

export class Input {
    constructor() {
        this.steer = 0;          // -1..1 (right positive)
        this.hasMotion = false;

        this._rawTilt = 0;       // from device, after calibration
        this._tiltBase = null;   // calibration baseline (gamma at start)
        this._key = 0;           // -1 / 0 / +1 from keyboard
        this._pointer = 0;       // -1..1 from drag
        this._pointerActive = false;

        this._onOrient = this._onOrient.bind(this);
        this._installKeyboard();
        this._installPointer();
    }

    // Called from the start-tap gesture so iOS grants motion access.
    async enableMotion() {
        try {
            const DOE = window.DeviceOrientationEvent;
            if (DOE && typeof DOE.requestPermission === 'function') {
                const res = await DOE.requestPermission();
                if (res !== 'granted') return false;
            }
            window.addEventListener('deviceorientation', this._onOrient, true);
            this.hasMotion = true;
            this._tiltBase = null; // recalibrate on (re)start
            return true;
        } catch (e) {
            return false;
        }
    }

    // Re-zero the tilt baseline to the current hold angle.
    calibrate() {
        this._tiltBase = null;
    }

    _onOrient(ev) {
        // gamma: left-right tilt in degrees (~ -90..90 in portrait)
        let g = ev.gamma;
        if (g == null) return;
        if (this._tiltBase == null) this._tiltBase = g;
        const rel = g - this._tiltBase;
        this._rawTilt = Math.max(-1, Math.min(1, rel / TILT_RANGE_DEG));
    }

    _installKeyboard() {
        // down -> set direction; up -> clear that direction
        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { this._key = -1; e.preventDefault(); }
            else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { this._key = 1; e.preventDefault(); }
        });
        window.addEventListener('keyup', (e) => {
            if (((e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') && this._key === -1) ||
                ((e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') && this._key === 1)) {
                this._key = 0;
            }
        });
    }

    _installPointer() {
        // Drag horizontally to steer; centre of drag = no input. Only used as a
        // fallback when there's no usable tilt (desktop / permission denied).
        let startX = 0;
        const down = (x) => { this._pointerActive = true; startX = x; this._pointer = 0; };
        const move = (x) => {
            if (!this._pointerActive) return;
            const dx = x - startX;
            this._pointer = Math.max(-1, Math.min(1, dx / 90));
        };
        const up = () => { this._pointerActive = false; this._pointer = 0; };

        window.addEventListener('pointerdown', (e) => down(e.clientX));
        window.addEventListener('pointermove', (e) => move(e.clientX));
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    }

    // When the gyroscope is available it is the sole control (the player chose
    // tilt-only), so a resting thumb never steers. Keyboard/drag only stand in
    // when there's no motion sensor (desktop / permission denied).
    sample() {
        let target;
        if (this.hasMotion) {
            target = this._rawTilt;
        } else if (this._key !== 0) {
            target = this._key;
        } else if (this._pointerActive) {
            target = this._pointer;
        } else {
            target = 0;
        }
        // small deadzone for tilt jitter
        if (Math.abs(target) < 0.06) target = 0;
        return target;
    }
}
