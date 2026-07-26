// Touch controls (left stick + right buttons + camera drag), a keyboard
// fallback for desktop, and a full gamepad layer.

import { clamp } from './util.js';

/* Standard-mapping button indices. Every MFi, Xbox and DualSense pad reports
   `mapping: 'standard'` on iOS, which is what makes a fixed table safe.
     0 A/Cross   1 B/Circle  2 X/Square  3 Y/Triangle
     4 LB  5 RB  6 LT  7 RT  8 Back/Share  9 Start/Options
     10 L3  11 R3   12/13/14/15 dpad U/D/L/R                                */
const PAD = {
  jump: 0,        // A -- also handbrake in a car, as in GTA
  hand: 0,
  back: 1,        // B -- menus only
  attack: 2,      // X
  enter: 3,       // Y -- enter/exit vehicle
  sprintAlt: 5,   // RB
  brake: 6,       // LT -- analogue
  gas: 7,         // RT -- analogue
  map: 8,         // Back/Share
  pause: 9,       // Start/Options
  horn: 10,       // L3 -- GTA puts the horn on the left stick click
  sprint: 10,     // ...and on foot the same click is hold-to-sprint
  radioPrev: 14,  // dpad left
  radioNext: 15,  // dpad right
  navUp: 12,
  navDown: 13,
};
const DEAD = 0.16;
const LOOK_RATE = 2.9;     // rad/s at full deflection
const TRIGGER_ON = 0.12;   // where an analogue trigger starts counting as held

export class Controls {
  constructor(root) {
    this.root = root;
    this.stick = { x: 0, y: 0 };
    this.btn = {};
    this.camDX = 0;
    this.camDY = 0;
    this.mode = 'foot';
    this._pointers = new Map();
    this._stickId = null;
    this._lookId = null;
    this.sensitivity = 1;

    // --- gamepad ---
    this.hasPad = false;
    this._padIndex = null;
    this._padPrev = [];
    this._padStick = { x: 0, y: 0 };
    this._padGas = 0;
    this._padBrake = 0;
    this._padHeld = {};
    this._ui = { pause: false, map: false, radio: 0, nav: 0, navX: 0, confirm: false, back: false, warp: false };
    this._padLook = { x: 0, y: 0 };
    window.addEventListener('gamepadconnected', (e) => {
      this._padIndex = e.gamepad.index;
      this.setPad(true);
    });
    window.addEventListener('gamepaddisconnected', () => {
      this._padIndex = null;
      this.setPad(false);
      this._padStick = { x: 0, y: 0 };
      this._padGas = this._padBrake = 0;
      this._padHeld = {};
    });

    this.stickBase = root.querySelector('#stickBase');
    this.stickKnob = root.querySelector('#stickKnob');
    this.stickZone = root.querySelector('#stickZone');
    this.lookZone = root.querySelector('#lookZone');
    this.buttons = Array.from(root.querySelectorAll('[data-btn]'));

    for (const b of this.buttons) this.btn[b.dataset.btn] = false;

    const opts = { passive: false };
    this.stickZone.addEventListener('pointerdown', (e) => this.onStickDown(e), opts);
    window.addEventListener('pointermove', (e) => this.onMove(e), opts);
    window.addEventListener('pointerup', (e) => this.onUp(e), opts);
    window.addEventListener('pointercancel', (e) => this.onUp(e), opts);
    this.lookZone.addEventListener('pointerdown', (e) => this.onLookDown(e), opts);

    // A held pointer can end without ever delivering pointerup: iOS steals the
    // gesture at a screen edge, an overlay opens over the finger, or a captured
    // element gets display:none'd on a mode switch. Every one of those fires
    // lostpointercapture instead, so listen for it everywhere a press is held.
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.stickZone.addEventListener(ev, (e) => {
        if (e.pointerId === this._stickId) this.releaseStick();
      }, opts);
      this.lookZone.addEventListener(ev, (e) => {
        if (e.pointerId === this._lookId) this.releaseLook();
      }, opts);
    }

    for (const b of this.buttons) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { b.setPointerCapture?.(e.pointerId); } catch (err) { /* capture is best-effort */ }
        this.btn[b.dataset.btn] = true;
        this._pointers.set(e.pointerId, { kind: 'btn', el: b });
        b.classList.add('down');
        if (b.dataset.tap) this.tapped = b.dataset.btn;
      }, opts);
      const up = (e) => {
        if (!this._pointers.has(e.pointerId)) return;
        this._pointers.delete(e.pointerId);
        this.btn[b.dataset.btn] = false;
        b.classList.remove('down');
      };
      b.addEventListener('pointerup', up, opts);
      b.addEventListener('pointercancel', up, opts);
      b.addEventListener('lostpointercapture', up, opts);
      b.addEventListener('pointerleave', (e) => {
        if (e.buttons === 0) up(e);
      });
    }

    // Last resort: anything that takes the app away drops every held input.
    const panic = () => this.resetAll();
    window.addEventListener('blur', panic);
    window.addEventListener('pagehide', panic);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) panic();
    });

    // keyboard
    this.keys = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF' || e.code === 'KeyE') this.tapped = 'enter';
      if (e.code === 'Space') this.tapped = 'jump';
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /**
   * Show or hide the touch controls for a pad.
   *
   * Driven by any button OR stick movement, not just `gamepadconnected`: iOS
   * does not expose a pad until the player presses something on it, and a
   * player who navigates with the d-pad alone would otherwise keep a full set
   * of thumb controls sitting over the screen.
   */
  setPad(on) {
    if (this.hasPad === on) return;
    this.hasPad = on;
    this.root.dataset.pad = on ? '1' : '';
    if (on) this.releaseStick();
  }

  /**
   * Poll the gamepad. Call once per frame BEFORE read()/takeLook(), and call it
   * even while paused -- otherwise the pause menu it opened cannot be navigated
   * with the same pad that opened it.
   */
  poll(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = this._padIndex !== null ? pads[this._padIndex] : null;
    if (!gp || !gp.connected) {
      gp = null;
      for (const p of pads) if (p && p.connected) { gp = p; this._padIndex = p.index; break; }
    }
    if (!gp) {
      if (this.hasPad) this.setPad(false);
      return;
    }

    const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
    const ax = gp.axes || [];
    const lx = dz(ax[0] || 0), ly = dz(ax[1] || 0);
    const rx = dz(ax[2] || 0), ry = dz(ax[3] || 0);
    const b = gp.buttons || [];
    const raw = (i) => (b[i] ? (b[i].value != null ? b[i].value : (b[i].pressed ? 1 : 0)) : 0);
    const down = (i) => !!(b[i] && (b[i].pressed || b[i].value > TRIGGER_ON));

    let any = lx || ly || rx || ry;
    for (let i = 0; i < b.length && !any; i++) if (down(i)) any = true;
    if (any) this.setPad(true);

    this._padStick = { x: lx, y: ly };
    this._padLook = { x: rx, y: ry };
    // Squared response: precise near the centre, quick at the edge. Multiplied
    // by dt because this is a rate, unlike the touch drag which is a delta.
    this.camDX += rx * Math.abs(rx) * LOOK_RATE * dt * this.sensitivity;
    this.camDY += ry * Math.abs(ry) * LOOK_RATE * dt * this.sensitivity;

    // Analogue triggers, passed through as 0..1 -- vehicles.js already takes a
    // continuous throttle, so a pad gets real modulation rather than on/off.
    this._padGas = raw(PAD.gas);
    this._padBrake = raw(PAD.brake);

    const held = {};
    for (const k of ['jump', 'hand', 'attack', 'horn', 'sprint', 'sprintAlt']) held[k] = down(PAD[k]);
    this._padHeld = held;

    const edge = (i) => down(i) && !this._padPrev[i];
    if (edge(PAD.enter)) this.tapped = 'enter';
    if (edge(PAD.jump) && this.mode !== 'drive') this.tapped = 'jump';
    if (edge(PAD.pause)) this._ui.pause = true;
    if (edge(PAD.map)) this._ui.map = true;
    if (edge(PAD.radioNext)) this._ui.radio = 1;
    if (edge(PAD.radioPrev)) this._ui.radio = -1;
    if (edge(PAD.jump)) this._ui.confirm = true;
    if (edge(PAD.back)) this._ui.back = true;
    if (edge(PAD.attack)) this._ui.warp = true;   // X arms the map's spawn picker

    // Menu cursor: d-pad or left stick, edge-triggered so a held direction
    // moves one item rather than forty.
    const navNow = (down(PAD.navDown) || ly > 0.55) ? 1 : ((down(PAD.navUp) || ly < -0.55) ? -1 : 0);
    if (navNow && navNow !== this._navPrev) this._ui.nav = navNow;
    this._navPrev = navNow;
    const navXNow = (down(PAD.radioNext) || lx > 0.55) ? 1 : ((down(PAD.radioPrev) || lx < -0.55) ? -1 : 0);
    if (navXNow && navXNow !== this._navXPrev) this._ui.navX = navXNow;
    this._navXPrev = navXNow;

    this._padPrev = [];
    for (let i = 0; i < b.length; i++) this._padPrev[i] = down(i);
  }

  /** Consume the pad's UI edges. Menus own these; gameplay never sees them. */
  takeUi() {
    const u = this._ui;
    this._ui = { pause: false, map: false, radio: 0, nav: 0, navX: 0, confirm: false, back: false, warp: false };
    return u;
  }

  /** Raw pad sticks, for UI that steers something itself (the map crosshair). */
  padLook() { return this._padLook; }
  padMove() { return this._padStick; }

  releaseStick() {
    if (this._stickId !== null) this._pointers.delete(this._stickId);
    this._stickId = null;
    this.stick.x = 0;
    this.stick.y = 0;
    this.stickBase.classList.remove('active');
    this.stickKnob.style.transform = 'translate(-50%,-50%)';
  }

  releaseLook() {
    if (this._lookId !== null) this._pointers.delete(this._lookId);
    this._lookId = null;
  }

  /** Drop every held input. Used when the app loses focus or is backgrounded. */
  resetAll() {
    this.releaseStick();
    this.releaseLook();
    for (const b of this.buttons) {
      this.btn[b.dataset.btn] = false;
      b.classList.remove('down');
    }
    this._pointers.clear();
    this.keys.clear();
  }

  onStickDown(e) {
    e.preventDefault();
    // Never refuse a new touch because an old one is still "held". If a
    // pointerup went missing, refusing here latched the stick at its last
    // deflection with no way to ever grab it again. Last touch wins.
    if (this._stickId !== null && this._stickId !== e.pointerId) this.releaseStick();
    this._stickId = e.pointerId;
    try { this.stickZone.setPointerCapture?.(e.pointerId); } catch (err) { /* best-effort */ }
    const r = this.stickZone.getBoundingClientRect();
    this._stickOrigin = { x: e.clientX, y: e.clientY };
    this.stickBase.style.left = `${e.clientX - r.left}px`;
    this.stickBase.style.top = `${e.clientY - r.top}px`;
    this.stickBase.classList.add('active');
    this._pointers.set(e.pointerId, { kind: 'stick' });
    this.updateStick(e.clientX, e.clientY);
  }

  onLookDown(e) {
    e.preventDefault();
    if (this._lookId !== null && this._lookId !== e.pointerId) this.releaseLook();
    this._lookId = e.pointerId;
    try { this.lookZone.setPointerCapture?.(e.pointerId); } catch (err) { /* best-effort */ }
    this._lookLast = { x: e.clientX, y: e.clientY };
    this._pointers.set(e.pointerId, { kind: 'look' });
  }

  onMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    if (p.kind === 'stick') {
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    } else if (p.kind === 'look') {
      e.preventDefault();
      this.camDX += (e.clientX - this._lookLast.x) * 0.0055 * this.sensitivity;
      this.camDY += (e.clientY - this._lookLast.y) * 0.0045 * this.sensitivity;
      this._lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  onUp(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    this._pointers.delete(e.pointerId);
    if (p.kind === 'stick') {
      this.releaseStick();
    } else if (p.kind === 'look') {
      this.releaseLook();
    } else if (p.kind === 'btn') {
      this.btn[p.el.dataset.btn] = false;
      p.el.classList.remove('down');
    }
  }

  updateStick(cx, cy) {
    const R = 58;
    let dx = cx - this._stickOrigin.x;
    let dy = cy - this._stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    this.stick.x = clamp(dx / R, -1, 1);
    this.stick.y = clamp(dy / R, -1, 1);
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    // Getting in or out of a car display:none's the button set that is on
    // screen. A button held at that moment would otherwise stay latched on --
    // most memorably, exiting with GAS down left the throttle stuck open.
    for (const b of this.buttons) {
      this.btn[b.dataset.btn] = false;
      b.classList.remove('down');
    }
    for (const [id, p] of [...this._pointers]) {
      if (p.kind === 'btn') this._pointers.delete(id);
    }
    this.root.dataset.mode = mode;
  }

  /** Consume the accumulated look delta. */
  takeLook() {
    const d = { x: this.camDX, y: this.camDY };
    this.camDX = 0;
    this.camDY = 0;
    return d;
  }

  takeTap() {
    const t = this.tapped;
    this.tapped = null;
    return t;
  }

  key(...codes) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Merged analogue state, touch + keyboard + pad. */
  read() {
    if (this._stickId === null && (this.stick.x || this.stick.y)) this.releaseStick();
    let sx = this.stick.x, sy = this.stick.y;
    if (this.key('KeyA', 'ArrowLeft')) sx -= 1;
    if (this.key('KeyD', 'ArrowRight')) sx += 1;
    if (this.key('KeyW', 'ArrowUp')) sy -= 1;
    if (this.key('KeyS', 'ArrowDown')) sy += 1;
    sx += this._padStick.x;
    sy += this._padStick.y;

    const p = this._padHeld;
    const driving = this.mode === 'drive';
    // A is the handbrake in a car and jump on foot, and L3 is the horn in a car
    // and hold-to-sprint on foot -- both are what GTA does with those buttons.
    // Sprint is a HOLD, never a toggle: a toggle stays latched after the stick
    // is released, so you arrive somewhere still sprinting.
    const gasAmt = clamp(Math.max(
      this._padGas,
      (this.btn.gas || this.key('ArrowUp', 'KeyW')) ? 1 : 0,
    ), 0, 1);
    const brakeAmt = clamp(Math.max(
      this._padBrake,
      (this.btn.brake || this.key('ArrowDown', 'KeyS')) ? 1 : 0,
    ), 0, 1);
    return {
      x: clamp(sx, -1, 1),
      y: clamp(sy, -1, 1),
      gas: gasAmt > TRIGGER_ON,
      brake: brakeAmt > TRIGGER_ON,
      gasAmt,
      brakeAmt,
      hand: this.btn.hand || this.key('Space') || (driving && !!p.hand),
      sprint: this.btn.sprint || this.key('ShiftLeft', 'ShiftRight')
        || (!driving && (!!p.sprint || !!p.sprintAlt)),
      attack: this.btn.attack || this.key('KeyJ') || this.key('ControlLeft') || !!p.attack,
      horn: this.btn.horn || this.key('KeyH') || (driving && !!p.horn),
      jump: this.btn.jump || (!driving && !!p.jump),
    };
  }
}
