import { GRID_W, GRID_H, SAND_RESIST } from './config.js';

// Couples the SPH simulation to the terrain. Each frame, it walks the
// particle array, figures out which cell each particle is in, and adds
// kinetic-energy-proportional stress to that cell. Then it asks the
// terrain to erode based on accumulated stress.
//
// Also simulates "debris" — rocks and sticks that have been dislodged and
// are tumbling downstream. Debris can impact other cells and cause further
// material to fail, producing the domino effect.

export class Erosion {
    constructor(terrain, sph, audio) {
        this.terrain = terrain;
        this.sph = sph;
        this.audio = audio;
        this.debris = [];        // tumbling objects
        this.breachEvents = [];  // for audio/effects (list of {x,y,force})
    }

    step(dt) {
        this._applyParticleStress();
        this._updateFlowMag();
        const newBreaches = [];
        const debrisOut = [];
        this.terrain.erode(dt, debrisOut);
        for (const d of debrisOut) {
            this.debris.push(d);
            newBreaches.push({ x: d.x, y: d.y, kind: d.kind });
        }
        this._updateDebris(dt);
        this.terrain.clearStress();

        if (newBreaches.length > 0 && this.audio) {
            for (const b of newBreaches) {
                this.audio.playBreak(b.kind, b.x / GRID_W);
            }
        }
        this.breachEvents = newBreaches;
    }

    _applyParticleStress() {
        const { px, py, vx, vy, alive, capacity } = this.sph;
        const { terrain } = this;
        for (let p = 0; p < capacity; p++) {
            if (!alive[p]) continue;
            const ci = px[p] | 0;
            const cj = py[p] | 0;
            if (!terrain.inBounds(ci, cj)) continue;
            // Stress from horizontal kinetic energy × (elevation above particle)
            const v2 = vx[p] * vx[p] + vy[p] * vy[p];
            const e = terrain.elevation(ci, cj);
            // If the particle is near a raised cell, it pushes on the wall of that cell.
            // Use per-neighbor stress so materials on tall cells get stressed by fast water below.
            const stress = v2 * 0.06;
            terrain.accumulateStress(ci, cj, stress);
            // Bleed stress to neighbor cells the particle is pressing against
            const fx = px[p] - ci - 0.5;
            const fy = py[p] - cj - 0.5;
            if (fx > 0.2) terrain.accumulateStress(ci + 1, cj, stress * 0.7);
            if (fx < -0.2) terrain.accumulateStress(ci - 1, cj, stress * 0.7);
            if (fy > 0.2) terrain.accumulateStress(ci, cj + 1, stress * 0.7);
            if (fy < -0.2) terrain.accumulateStress(ci, cj - 1, stress * 0.7);
        }
    }

    _updateFlowMag() {
        const { px, py, vx, vy, alive, capacity } = this.sph;
        const { terrain } = this;
        // Exponential decay of previous frame's flow magnitude
        for (let k = 0; k < terrain.flowMag.length; k++) terrain.flowMag[k] *= 0.88;
        for (let p = 0; p < capacity; p++) {
            if (!alive[p]) continue;
            const ci = px[p] | 0;
            const cj = py[p] | 0;
            if (!terrain.inBounds(ci, cj)) continue;
            const speed = Math.sqrt(vx[p] * vx[p] + vy[p] * vy[p]);
            terrain.flowMag[terrain.idx(ci, cj)] = Math.min(
                10,
                terrain.flowMag[terrain.idx(ci, cj)] + speed * 0.02,
            );
        }
    }

    _updateDebris(dt) {
        const { terrain } = this;
        const surviving = [];
        for (const d of this.debris) {
            // Gravity on z
            d.vz -= 9 * dt;
            d.elevZ += d.vz * dt;
            if (d.elevZ < 0) d.elevZ = 0;

            // Slope-driven horizontal acceleration + downstream drift (diagonal)
            const g = terrain.gradientAt(d.x, d.y);
            const mass = d.kind === 'rock' ? 3.5 : 1.4;
            const downstreamNudge = 0.9 / mass;
            d.vx += (-g.dx * 6 / mass + downstreamNudge) * dt;
            d.vy += (-g.dy * 6 / mass + downstreamNudge) * dt;
            d.vx *= 1 - dt * 2.4;
            d.vy *= 1 - dt * 2.4;
            d.x += d.vx * dt;
            d.y += d.vy * dt;

            d.angle += d.spin * dt;
            d.spin *= 1 - dt * 1.5;
            d.life += dt;

            // Collide with terrain walls: if new cell has much higher elevation, bounce
            if (d.elevZ <= 0.05) {
                const ci = d.x | 0, cj = d.y | 0;
                if (terrain.inBounds(ci, cj)) {
                    const here = terrain.elevation(ci, cj);
                    // If we're still touching a raised cell (shouldn't happen often), nudge out
                    // and apply stress that might domino another material away.
                    const impact = Math.min(6, d.vx * d.vx + d.vy * d.vy);
                    const threshold = d.kind === 'rock' ? SAND_RESIST * 2 : SAND_RESIST;
                    if (impact > threshold) {
                        terrain.accumulateStress(ci, cj, impact * 1.2);
                        // Occasionally dislodge a neighbor rock/stick directly on impact
                        if (d.kind === 'rock') {
                            const nci = ci + Math.sign(d.vx || 1e-6) | 0;
                            const ncj = cj + Math.sign(d.vy || 1e-6) | 0;
                            if (terrain.inBounds(nci, ncj)) {
                                terrain.accumulateStress(nci, ncj, impact * 0.6);
                            }
                        }
                    }
                }
            }

            // Kill if past ocean (diagonal) or off-grid
            if ((d.x + d.y) > (GRID_W + GRID_H) - 1.5) continue;
            if (d.x < 0 || d.x > GRID_W || d.y < 0 || d.y > GRID_H) continue;
            // Kill if it comes to rest after long time
            if (d.life > 3.5 && Math.abs(d.vx) < 0.1 && Math.abs(d.vy) < 0.3) {
                // Deposit as sand at this spot (it got buried)
                const sandAmount = d.kind === 'rock' ? 0.3 : 0.15;
                terrain.addSand(d.x, d.y, 0.7, sandAmount);
                continue;
            }
            surviving.push(d);
        }
        this.debris = surviving;
    }

    reset() {
        this.debris.length = 0;
    }
}
