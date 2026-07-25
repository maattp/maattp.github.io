// Touch controls (left stick + right buttons + camera drag) with a keyboard
// fallback for desktop.

import { clamp } from './util.js';

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

    for (const b of this.buttons) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture?.(e.pointerId);
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
      b.addEventListener('pointerleave', (e) => {
        if (e.buttons === 0) up(e);
      });
    }

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

  onStickDown(e) {
    e.preventDefault();
    if (this._stickId !== null) return;
    this._stickId = e.pointerId;
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
    if (this._lookId !== null) return;
    this._lookId = e.pointerId;
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
      this._stickId = null;
      this.stick.x = 0;
      this.stick.y = 0;
      this.stickBase.classList.remove('active');
      this.stickKnob.style.transform = 'translate(-50%,-50%)';
    } else if (p.kind === 'look') {
      this._lookId = null;
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

  /** Merged analogue state, touch + keyboard. */
  read() {
    let sx = this.stick.x, sy = this.stick.y;
    if (this.key('KeyA', 'ArrowLeft')) sx -= 1;
    if (this.key('KeyD', 'ArrowRight')) sx += 1;
    if (this.key('KeyW', 'ArrowUp')) sy -= 1;
    if (this.key('KeyS', 'ArrowDown')) sy += 1;
    return {
      x: clamp(sx, -1, 1),
      y: clamp(sy, -1, 1),
      gas: this.btn.gas || this.key('ArrowUp', 'KeyW'),
      brake: this.btn.brake || this.key('ArrowDown', 'KeyS'),
      hand: this.btn.hand || this.key('Space'),
      sprint: this.btn.sprint || this.key('ShiftLeft', 'ShiftRight'),
      attack: this.btn.attack || this.key('KeyJ') || this.key('ControlLeft'),
      horn: this.btn.horn || this.key('KeyH'),
      jump: this.btn.jump,
    };
  }
}
