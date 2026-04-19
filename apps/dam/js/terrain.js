import {
    GRID_W, GRID_H,
    BEACH_SLOPE, STREAM_DEPTH, STREAM_WIDTH, STREAM_MEANDER, STREAM_FREQ,
    BANK_SLOPE, BANK_MAX, OCEAN_ROW,
    SPRING_POOL_ROWS, SPRING_POOL_EXTRA,
    SAND_UNIT_H, STICK_UNIT_H, ROCK_UNIT_H,
    SAND_RESIST, STICK_RESIST, ROCK_RESIST,
    EROSION_RATE,
} from './config.js';

// Terrain is a heightfield with layered materials on top of base terrain.
// Each cell has:
//   base: natural terrain elevation (carved stream + sandy beach)
//   sand: player-added sand (continuous float, scaled by SAND_UNIT_H)
//   rocks, sticks: arrays of discrete material objects placed in this cell
// Rocks and sticks raise elevation by their count × unit height.
// Stress accumulator tracks integrated water force for erosion.

let rockIdSeq = 1;

export class Terrain {
    constructor() {
        this.w = GRID_W;
        this.h = GRID_H;
        const n = GRID_W * GRID_H;
        this.base = new Float32Array(n);
        this.sand = new Float32Array(n);
        // Per-cell material arrays
        this.rockCells = new Array(n);
        this.stickCells = new Array(n);
        // Stress accumulators (for erosion); reset each frame
        this.stress = new Float32Array(n);
        // Total flow magnitude per cell, for visual shimmer
        this.flowMag = new Float32Array(n);

        // Stream centerline row lookup (cached for spring/ocean placement)
        this.streamCenter = new Float32Array(GRID_H);

        this._buildBaseTerrain();
        for (let i = 0; i < n; i++) {
            this.rockCells[i] = null;
            this.stickCells[i] = null;
        }

        this._scatterPebbles();
    }

    _buildBaseTerrain() {
        const { w, h, base, streamCenter } = this;
        for (let j = 0; j < h; j++) {
            // Ocean ramp: last few rows taper to elevation 0 (water level)
            const oceanT = Math.max(0, (j - OCEAN_ROW) / (h - 1 - OCEAN_ROW));
            // Beach slope rises upstream (decreasing j). Top row is highest.
            const beach = BEACH_SLOPE * (h - 1 - j);
            // Meandering stream center
            const cx = w * 0.5 + Math.sin(j * STREAM_FREQ) * STREAM_MEANDER
                       + Math.sin(j * 0.07 + 1.3) * 0.7;
            streamCenter[j] = cx;
            // Extra depth for the spring pool at the top rows
            const springT = j < SPRING_POOL_ROWS ? (1 - j / SPRING_POOL_ROWS) : 0;
            for (let i = 0; i < w; i++) {
                const dx = i - cx;
                // Smooth Lorentzian valley — deep at centerline, falls off with distance
                const valley = STREAM_DEPTH / (1 + Math.pow(dx / (STREAM_WIDTH * 0.6), 2));
                // Aggressive lateral rise outside the valley so water stays contained
                const bank = Math.min(BANK_MAX, Math.max(0, (Math.abs(dx) - STREAM_WIDTH) * BANK_SLOPE));
                // Noise for natural look (deterministic)
                const n = pseudoNoise(i, j) * 0.10;
                // Taper into ocean — widen the channel and drop the banks
                const bankSoften = 1 - oceanT * 0.9;
                let e = beach - valley * bankSoften + bank * bankSoften + n;
                // Spring pool: carve an extra bowl at the top
                if (springT > 0 && Math.abs(dx) < STREAM_WIDTH * 1.5) {
                    const bowl = SPRING_POOL_EXTRA * springT
                        * Math.max(0, 1 - Math.abs(dx) / (STREAM_WIDTH * 1.5));
                    e -= bowl;
                }
                e *= (1 - oceanT * 0.9);
                e -= oceanT * 0.6;
                base[j * w + i] = e;
            }
        }
    }

    _scatterPebbles() {
        // A few decorative pebbles on the banks (structural but breakable).
        let s = 1337;
        const rand = () => {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            return s / 0x7fffffff;
        };
        for (let j = 2; j < this.h - 4; j++) {
            const cx = this.streamCenter[j];
            for (let i = 0; i < this.w; i++) {
                const dx = Math.abs(i - cx);
                if (dx > STREAM_WIDTH + 0.5 && dx < STREAM_WIDTH + 3 && rand() < 0.08) {
                    this.addRock(i, j, rand);
                }
            }
        }
    }

    idx(i, j) { return j * this.w + i; }

    inBounds(i, j) {
        return i >= 0 && i < this.w && j >= 0 && j < this.h;
    }

    // Total elevation at cell (i, j): base + sand + rocks + sticks
    elevation(i, j) {
        if (!this.inBounds(i, j)) return 100; // off-grid: treated as solid wall
        const k = this.idx(i, j);
        let e = this.base[k] + this.sand[k];
        const rocks = this.rockCells[k];
        if (rocks) e += rocks.length * ROCK_UNIT_H;
        const sticks = this.stickCells[k];
        if (sticks) e += sticks.length * STICK_UNIT_H;
        return e;
    }

    // Bilinear elevation at continuous world position
    elevationAt(x, y) {
        const i0 = Math.floor(x), j0 = Math.floor(y);
        const fx = x - i0, fy = y - j0;
        const e00 = this.elevation(i0, j0);
        const e10 = this.elevation(i0 + 1, j0);
        const e01 = this.elevation(i0, j0 + 1);
        const e11 = this.elevation(i0 + 1, j0 + 1);
        return (e00 * (1 - fx) + e10 * fx) * (1 - fy)
             + (e01 * (1 - fx) + e11 * fx) * fy;
    }

    // Gradient of elevation at (x, y). Returns (dEdx, dEdy).
    gradientAt(x, y) {
        const d = 0.35;
        const ex = this.elevationAt(x + d, y) - this.elevationAt(x - d, y);
        const ey = this.elevationAt(x, y + d) - this.elevationAt(x, y - d);
        return { dx: ex / (2 * d), dy: ey / (2 * d) };
    }

    // Place sand in a splash area around (wx, wy) with radius r.
    addSand(wx, wy, r, amount) {
        const minI = Math.max(0, Math.floor(wx - r));
        const maxI = Math.min(this.w - 1, Math.ceil(wx + r));
        const minJ = Math.max(0, Math.floor(wy - r));
        const maxJ = Math.min(this.h - 1, Math.ceil(wy + r));
        for (let j = minJ; j <= maxJ; j++) {
            for (let i = minI; i <= maxI; i++) {
                const dx = i + 0.5 - wx, dy = j + 0.5 - wy;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < r) {
                    const falloff = 1 - d / r;
                    this.sand[this.idx(i, j)] += amount * falloff * falloff;
                }
            }
        }
    }

    dig(wx, wy, r, amount) {
        const minI = Math.max(0, Math.floor(wx - r));
        const maxI = Math.min(this.w - 1, Math.ceil(wx + r));
        const minJ = Math.max(0, Math.floor(wy - r));
        const maxJ = Math.min(this.h - 1, Math.ceil(wy + r));
        for (let j = minJ; j <= maxJ; j++) {
            for (let i = minI; i <= maxI; i++) {
                const dx = i + 0.5 - wx, dy = j + 0.5 - wy;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < r) {
                    const falloff = 1 - d / r;
                    const k = this.idx(i, j);
                    // First chew through added sand, then into base terrain.
                    const consume = amount * falloff;
                    const fromSand = Math.min(this.sand[k], consume);
                    this.sand[k] -= fromSand;
                    const remaining = consume - fromSand;
                    if (remaining > 0) {
                        this.base[k] -= remaining * 0.6;
                    }
                }
            }
        }
    }

    addRock(i, j, rand = Math.random) {
        if (!this.inBounds(i, j)) return null;
        const k = this.idx(i, j);
        if (!this.rockCells[k]) this.rockCells[k] = [];
        const rock = {
            id: rockIdSeq++,
            cellI: i, cellJ: j,
            offX: (rand() - 0.5) * 0.6,
            offY: (rand() - 0.5) * 0.6,
            size: 0.32 + rand() * 0.18,
            tone: 0.65 + rand() * 0.3,
            angle: rand() * Math.PI,
        };
        this.rockCells[k].push(rock);
        return rock;
    }

    addStick(i, j, rand = Math.random) {
        if (!this.inBounds(i, j)) return null;
        const k = this.idx(i, j);
        if (!this.stickCells[k]) this.stickCells[k] = [];
        const stick = {
            cellI: i, cellJ: j,
            offX: (rand() - 0.5) * 0.7,
            offY: (rand() - 0.5) * 0.7,
            length: 0.8 + rand() * 0.5,
            angle: rand() * Math.PI,
            tone: 0.55 + rand() * 0.35,
        };
        this.stickCells[k].push(stick);
        return stick;
    }

    // Remove the top rock from a cell. Returns it (or null).
    popRock(i, j) {
        const rocks = this.rockCells[this.idx(i, j)];
        if (!rocks || rocks.length === 0) return null;
        return rocks.pop();
    }

    popStick(i, j) {
        const sticks = this.stickCells[this.idx(i, j)];
        if (!sticks || sticks.length === 0) return null;
        return sticks.pop();
    }

    clearStress() {
        this.stress.fill(0);
    }

    accumulateStress(i, j, amount) {
        if (!this.inBounds(i, j)) return;
        this.stress[this.idx(i, j)] += amount;
    }

    // Apply erosion given the accumulated stress this frame.
    // `debrisOut` collects dislodged rocks/sticks as debris objects.
    erode(dt, debrisOut) {
        const { w, h, stress, sand, rockCells, stickCells, base } = this;
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const k = j * w + i;
                const s = stress[k];
                if (s <= 0) continue;

                // Sand is the easiest — gradually washed.
                if (sand[k] > 0 && s > SAND_RESIST) {
                    const removed = Math.min(sand[k], (s - SAND_RESIST) * EROSION_RATE * dt);
                    sand[k] -= removed;
                    if (sand[k] < 0.0001) sand[k] = 0;
                }

                // When sand is depleted, gently nibble base terrain near the stream bed only.
                if (sand[k] === 0 && base[k] < 0.5 && s > SAND_RESIST * 2) {
                    base[k] -= Math.min(0.04, (s - SAND_RESIST * 2) * 0.03 * dt);
                }

                // Sticks next. Need sand to be thin (no protection).
                const sticks = stickCells[k];
                if (sticks && sticks.length > 0 && sand[k] < 0.4 && s > STICK_RESIST) {
                    const stick = sticks.pop();
                    const angle = Math.atan2(
                        this._stressDir(i, j, 1),
                        this._stressDir(i, j, 0),
                    );
                    debrisOut.push(makeDebris('stick', i + 0.5 + stick.offX * 0.3,
                        j + 0.5 + stick.offY * 0.3, angle, stick));
                }

                // Rocks: need much more force. When they go, emit a "break" event.
                const rocks = rockCells[k];
                if (rocks && rocks.length > 0 && sand[k] < 0.4 && s > ROCK_RESIST) {
                    const rock = rocks.pop();
                    const angle = Math.atan2(
                        this._stressDir(i, j, 1),
                        this._stressDir(i, j, 0),
                    );
                    debrisOut.push(makeDebris('rock', i + 0.5 + rock.offX * 0.3,
                        j + 0.5 + rock.offY * 0.3, angle, rock));
                }
            }
        }
    }

    // Returns a rough directional component of stress via neighbor lookups.
    _stressDir(i, j, axis) {
        // axis 0 = x, 1 = y. Use the flow magnitude stored during force pass.
        if (axis === 0) {
            const l = this.inBounds(i - 1, j) ? this.stress[this.idx(i - 1, j)] : 0;
            const r = this.inBounds(i + 1, j) ? this.stress[this.idx(i + 1, j)] : 0;
            return r - l;
        } else {
            const u = this.inBounds(i, j - 1) ? this.stress[this.idx(i, j - 1)] : 0;
            const d = this.inBounds(i, j + 1) ? this.stress[this.idx(i, j + 1)] : 0;
            return d - u;
        }
    }
}

function makeDebris(kind, x, y, flowAngle, props) {
    return {
        kind,
        x, y,
        vx: Math.cos(flowAngle) * 2.5 + (Math.random() - 0.5) * 0.8,
        vy: Math.sin(flowAngle) * 2.5 + 2.4,  // downstream bias
        angle: props.angle || 0,
        spin: (Math.random() - 0.5) * 6,
        life: 0,
        size: props.size ?? (kind === 'rock' ? 0.36 : 0.2),
        length: props.length ?? 1.0,
        tone: props.tone ?? 0.7,
        elevZ: 0.25,          // starts just above surface
        vz: 1.2 + Math.random() * 0.6,
        settled: false,
    };
}

function pseudoNoise(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1; // -1..1
}
