import { ROCK_CD, STICK_CD, GRID_W, GRID_H, SAND_PLACE_AMOUNT, SAND_PLACE_RADIUS, DIG_AMOUNT } from './config.js';

// Manages the active tool, cooldown UI, and pointer (touch/mouse) events
// on the canvas. Placement is throttled so a drag emits a steady stream
// of place events, not hundreds per second.

export class Controls {
    constructor(canvas, renderer, terrain, audio) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.terrain = terrain;
        this.audio = audio;
        this.activeTool = 'sand';
        this.toolButtons = {};
        this.cooldowns = { rock: 0, stick: 0 };
        this.cooldownMax = { rock: ROCK_CD, stick: STICK_CD };
        this.lastDragPlaceTime = 0;
        this.pointerActive = false;
        this.lastX = 0;
        this.lastY = 0;
        this._setupToolbar();
        this._setupPointerEvents();
    }

    _setupToolbar() {
        const buttons = document.querySelectorAll('.tool');
        buttons.forEach(btn => {
            this.toolButtons[btn.dataset.tool] = btn;
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                this.setTool(btn.dataset.tool);
                this.audio?.unlock();
            });
        });
    }

    setTool(name) {
        this.activeTool = name;
        for (const tool in this.toolButtons) {
            this.toolButtons[tool].classList.toggle('active', tool === name);
        }
    }

    _setupPointerEvents() {
        const c = this.canvas;
        const onDown = (ev) => {
            ev.preventDefault();
            this.audio?.unlock();
            this.pointerActive = true;
            const { x, y } = this._clientXY(ev);
            this.lastX = x;
            this.lastY = y;
            this._attemptPlace(x, y, true);
        };
        const onMove = (ev) => {
            if (!this.pointerActive) return;
            ev.preventDefault();
            const { x, y } = this._clientXY(ev);
            // Continuous drag placement (throttled)
            this.lastX = x;
            this.lastY = y;
            this._attemptPlace(x, y, false);
        };
        const onUp = (ev) => {
            this.pointerActive = false;
        };
        c.addEventListener('pointerdown', onDown);
        c.addEventListener('pointermove', onMove);
        c.addEventListener('pointerup', onUp);
        c.addEventListener('pointercancel', onUp);
        c.addEventListener('pointerleave', onUp);
    }

    _clientXY(ev) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
        };
    }

    _attemptPlace(cx, cy, isTap) {
        const world = this.renderer.clientToWorld(cx, cy);
        if (world.x < 0 || world.x >= GRID_W || world.y < 0 || world.y >= GRID_H) return;
        const tool = this.activeTool;

        if (tool === 'sand') {
            const now = performance.now();
            if (!isTap && now - this.lastDragPlaceTime < 28) return;
            this.lastDragPlaceTime = now;
            this.terrain.addSand(world.x, world.y, SAND_PLACE_RADIUS, SAND_PLACE_AMOUNT * (isTap ? 1.0 : 0.55));
            this.audio?.playPlace('sand');
        } else if (tool === 'dig') {
            const now = performance.now();
            if (!isTap && now - this.lastDragPlaceTime < 28) return;
            this.lastDragPlaceTime = now;
            this.terrain.dig(world.x, world.y, SAND_PLACE_RADIUS, DIG_AMOUNT * (isTap ? 1.0 : 0.55));
            this.audio?.playPlace('dig');
        } else if (tool === 'rock') {
            if (this.cooldowns.rock > 0) return;
            const ci = Math.floor(world.x), cj = Math.floor(world.y);
            this.terrain.addRock(ci, cj);
            this.cooldowns.rock = this.cooldownMax.rock;
            this.audio?.playPlace('rock');
        } else if (tool === 'stick') {
            if (this.cooldowns.stick > 0) return;
            const ci = Math.floor(world.x), cj = Math.floor(world.y);
            this.terrain.addStick(ci, cj);
            this.cooldowns.stick = this.cooldownMax.stick;
            this.audio?.playPlace('stick');
        }
    }

    update(dtMs) {
        for (const tool of ['rock', 'stick']) {
            if (this.cooldowns[tool] > 0) {
                this.cooldowns[tool] = Math.max(0, this.cooldowns[tool] - dtMs);
                const btn = this.toolButtons[tool];
                const frac = this.cooldowns[tool] / this.cooldownMax[tool];
                btn.classList.toggle('cooling', frac > 0);
                btn.style.setProperty('--fill', `${frac * 360}deg`);
            }
        }
    }
}
