// Input device layer. The ONLY job here is to turn keyboards and touches into
// the device-agnostic input struct the simulation consumes:
//   { steer: -1..1, accelerate: bool, brake: bool, drift: bool }
//
// This file is intentionally the only place that knows about pointers and keys.
// The simulation never sees any of it — which is what lets the sim run remotely
// later. Touch layout (landscape): left thumb = analog steering drag zone,
// right thumb = accelerate / drift / brake buttons.

const STEER_TRAVEL = 70; // px of horizontal drag from touch-down for full lock

export class Input {
    constructor(els) {
        // Auto-accelerate: the kart always drives forward unless braking. This is
        // the standard mobile-kart control because it frees the right thumb to
        // drift — you can't hold a gas button AND a drift button with one thumb.
        this.autoAccel = true;

        // touch state
        this._touchSteer = 0;
        this._steerId = null;
        this._steerStartX = 0;
        this._accel = false;
        this._brake = false;
        this._drift = false;

        // keyboard state (digital)
        this._keyLeft = false;
        this._keyRight = false;
        this._keyAccel = false;
        this._keyBrake = false;
        this._keyDrift = false;
        this._usingKeyboard = false;

        this._installKeyboard();
        if (els) this._installTouch(els);
    }

    _installKeyboard() {
        const set = (e, down) => {
            switch (e.key) {
                case 'ArrowLeft': case 'a': case 'A': this._keyLeft = down; break;
                case 'ArrowRight': case 'd': case 'D': this._keyRight = down; break;
                case 'ArrowUp': case 'w': case 'W': this._keyAccel = down; break;
                case 'ArrowDown': case 's': case 'S': this._keyBrake = down; break;
                case ' ': case 'Shift': this._keyDrift = down; break;
                default: return;
            }
            this._usingKeyboard = true;
            e.preventDefault();
        };
        window.addEventListener('keydown', (e) => set(e, true));
        window.addEventListener('keyup', (e) => set(e, false));
    }

    _installTouch(els) {
        const { steerZone, accel, brake, drift } = els;

        // analog steering: drag horizontally from wherever the thumb lands
        steerZone.addEventListener('pointerdown', (e) => {
            this._steerId = e.pointerId;
            this._steerStartX = e.clientX;
            this._touchSteer = 0;
            steerZone.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        steerZone.addEventListener('pointermove', (e) => {
            if (e.pointerId !== this._steerId) return;
            const dx = e.clientX - this._steerStartX;
            this._touchSteer = clamp(dx / STEER_TRAVEL, -1, 1);
            e.preventDefault();
        });
        const endSteer = (e) => {
            if (e.pointerId !== this._steerId) return;
            this._steerId = null;
            this._touchSteer = 0;
        };
        steerZone.addEventListener('pointerup', endSteer);
        steerZone.addEventListener('pointercancel', endSteer);

        // momentary buttons
        bindButton(accel, (v) => { this._accel = v; });
        bindButton(brake, (v) => { this._brake = v; });
        bindButton(drift, (v) => { this._drift = v; });
    }

    // Device-agnostic snapshot handed to the simulation.
    sample() {
        let steer = this._touchSteer;
        let brake = this._brake || this._keyBrake;
        let drift = this._drift || this._keyDrift;

        // keyboard steer overlays (so desktop testing works with touch els present)
        if (this._keyLeft) steer = -1;
        if (this._keyRight) steer = 1;

        // auto-accelerate unless braking; a held gas button/key can still force it
        let accelerate;
        if (this.autoAccel) accelerate = !brake;
        else accelerate = this._accel || this._keyAccel;
        if (this._accel || this._keyAccel) accelerate = true;

        if (Math.abs(steer) < 0.04) steer = 0; // tiny deadzone
        return { steer, accelerate, brake, drift };
    }
}

function bindButton(el, set) {
    if (!el) return;
    const down = (e) => { set(true); el.classList.add('pressed'); el.setPointerCapture?.(e.pointerId); e.preventDefault(); };
    const up = (e) => { set(false); el.classList.remove('pressed'); e.preventDefault(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
