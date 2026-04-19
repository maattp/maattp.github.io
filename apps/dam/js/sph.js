import {
    GRID_W, GRID_H, H, H2,
    REST_DENSITY, STIFFNESS, VISCOSITY, GRAVITY,
    TERRAIN_WALL_K, TERRAIN_DAMP,
    MAX_PARTICLES, MAX_SPEED, PARTICLE_MASS,
    SPAWN_PER_SEC, SPAWN_JITTER,
    OCEAN_ROW,
} from './config.js';

// 2D Müller-style SPH. Top-down flow where "gravity" is actually the
// gradient of the terrain elevation (shallow-water style), plus a
// small downstream bias that keeps flow going toward the ocean.
//
// Layout of particle data in typed arrays so we can iterate cache-friendly.

const POLY6 = 315 / (64 * Math.PI * Math.pow(H, 9));
const SPIKY_GRAD = -45 / (Math.PI * Math.pow(H, 6));
const VISC_LAP = 45 / (Math.PI * Math.pow(H, 6));

export class SPH {
    constructor(terrain) {
        this.terrain = terrain;
        const N = MAX_PARTICLES;
        this.px = new Float32Array(N);
        this.py = new Float32Array(N);
        this.vx = new Float32Array(N);
        this.vy = new Float32Array(N);
        this.density = new Float32Array(N);
        this.pressure = new Float32Array(N);
        this.fx = new Float32Array(N);
        this.fy = new Float32Array(N);
        // Cell index per particle for hashing
        this.alive = new Uint8Array(N);
        this.count = 0;
        this.capacity = N;

        // Spatial hash: cell size = H. Domain slightly padded on both sides.
        this.hashCellSize = H;
        this.hashCols = Math.ceil((GRID_W + 2) / H) + 2;
        this.hashRows = Math.ceil((GRID_H + 2) / H) + 2;
        this.hashHeads = new Int32Array(this.hashCols * this.hashRows);
        this.hashNext = new Int32Array(N);

        this.spawnAccumulator = 0;
        this.freeList = [];
        for (let i = N - 1; i >= 0; i--) this.freeList.push(i);
    }

    _spawn(x, y, vx, vy) {
        if (this.freeList.length === 0) return -1;
        const idx = this.freeList.pop();
        this.px[idx] = x;
        this.py[idx] = y;
        this.vx[idx] = vx;
        this.vy[idx] = vy;
        this.fx[idx] = 0;
        this.fy[idx] = 0;
        this.density[idx] = REST_DENSITY;
        this.pressure[idx] = 0;
        this.alive[idx] = 1;
        this.count++;
        return idx;
    }

    _kill(idx) {
        this.alive[idx] = 0;
        this.freeList.push(idx);
        this.count--;
    }

    _hashIndex(i, j) {
        if (i < 0 || j < 0 || i >= this.hashCols || j >= this.hashRows) return -1;
        return j * this.hashCols + i;
    }

    _rebuildHash() {
        this.hashHeads.fill(-1);
        const invH = 1 / this.hashCellSize;
        for (let p = 0; p < this.capacity; p++) {
            if (!this.alive[p]) continue;
            const ci = ((this.px[p] + 1) * invH) | 0;
            const cj = ((this.py[p] + 1) * invH) | 0;
            const h = this._hashIndex(ci, cj);
            if (h < 0) {
                this.hashNext[p] = -1;
                continue;
            }
            this.hashNext[p] = this.hashHeads[h];
            this.hashHeads[h] = p;
        }
    }

    _forEachNeighbor(p, cb) {
        const invH = 1 / this.hashCellSize;
        const ci = ((this.px[p] + 1) * invH) | 0;
        const cj = ((this.py[p] + 1) * invH) | 0;
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                const h = this._hashIndex(ci + di, cj + dj);
                if (h < 0) continue;
                let q = this.hashHeads[h];
                while (q !== -1) {
                    cb(q);
                    q = this.hashNext[q];
                }
            }
        }
    }

    step(dt) {
        this._rebuildHash();
        this._computeDensity();
        this._computeForces();
        this._integrate(dt);
        this._handleBoundaries();
    }

    _computeDensity() {
        const { px, py, density, pressure, alive } = this;
        for (let p = 0; p < this.capacity; p++) {
            if (!alive[p]) continue;
            let dens = 0;
            const ppx = px[p], ppy = py[p];
            this._forEachNeighbor(p, (q) => {
                const dx = px[q] - ppx;
                const dy = py[q] - ppy;
                const r2 = dx * dx + dy * dy;
                if (r2 < H2) {
                    const diff = H2 - r2;
                    dens += PARTICLE_MASS * POLY6 * diff * diff * diff;
                }
            });
            density[p] = Math.max(dens, REST_DENSITY * 0.2);
            pressure[p] = STIFFNESS * (density[p] - REST_DENSITY);
            if (pressure[p] < 0) pressure[p] = 0;
        }
    }

    _computeForces() {
        const { px, py, vx, vy, density, pressure, fx, fy, alive, terrain } = this;
        for (let p = 0; p < this.capacity; p++) {
            if (!alive[p]) continue;
            let ax = 0, ay = 0;
            const ppx = px[p], ppy = py[p];
            const pPress = pressure[p];
            const pVx = vx[p], pVy = vy[p];

            this._forEachNeighbor(p, (q) => {
                if (q === p) return;
                const dx = px[q] - ppx;
                const dy = py[q] - ppy;
                const r2 = dx * dx + dy * dy;
                if (r2 >= H2 || r2 === 0) return;
                const r = Math.sqrt(r2);
                const nx = dx / r, ny = dy / r;  // unit vector from P -> Q
                const diff = H - r;
                // Pressure (spiky kernel gradient). SPIKY_GRAD is negative,
                // so pTerm is negative and ax += nx * pTerm pushes P *away* from Q.
                const pTerm = PARTICLE_MASS
                    * (pPress + pressure[q]) / (2 * density[q])
                    * SPIKY_GRAD * diff * diff;
                ax += nx * pTerm;
                ay += ny * pTerm;
                // Viscosity (laplacian of poly6-ish — use VISC_LAP * (H-r))
                const visc = VISCOSITY * PARTICLE_MASS
                    * VISC_LAP * diff / density[q];
                ax += (vx[q] - pVx) * visc;
                ay += (vy[q] - pVy) * visc;
            });

            // Gravity: along the terrain gradient (flow downhill)
            const g = terrain.gradientAt(ppx, ppy);
            ax -= g.dx * GRAVITY;
            ay -= g.dy * GRAVITY;
            // Slight downstream bias so stagnation doesn't kill the flow entirely
            ay += 0.6;

            // Wall from nearby terrain elevation that exceeds particle "level"
            // Estimate effective water surface height via density.
            const waterSurface = pileHeightFromDensity(density[p]);
            const cellI = ppx | 0, cellJ = ppy | 0;
            // Push away from neighbor cells whose elevation is too tall
            for (let dj = -1; dj <= 1; dj++) {
                for (let di = -1; di <= 1; di++) {
                    const ci = cellI + di, cj = cellJ + dj;
                    if (!terrain.inBounds(ci, cj)) continue;
                    const e = terrain.elevation(ci, cj);
                    // "Floor" of this cell relative to local water surface
                    const myFloor = terrain.elevationAt(ppx, ppy);
                    const overhead = e - (myFloor + waterSurface);
                    if (overhead > 0) {
                        // Closest point on cell bounds
                        const cx = Math.max(ci, Math.min(ci + 1, ppx));
                        const cy = Math.max(cj, Math.min(cj + 1, ppy));
                        const rx = ppx - cx;
                        const ry = ppy - cy;
                        const d = Math.sqrt(rx * rx + ry * ry);
                        if (d < 0.4 && d > 1e-4) {
                            const push = TERRAIN_WALL_K * overhead * (0.4 - d);
                            ax += (rx / d) * push;
                            ay += (ry / d) * push;
                            // Damp velocity into the wall
                            const vn = pVx * (-rx / d) + pVy * (-ry / d);
                            if (vn > 0) {
                                ax -= (-rx / d) * vn * TERRAIN_DAMP;
                                ay -= (-ry / d) * vn * TERRAIN_DAMP;
                            }
                        }
                    }
                }
            }

            fx[p] = ax;
            fy[p] = ay;
        }
    }

    _integrate(dt) {
        const { px, py, vx, vy, fx, fy, alive } = this;
        for (let p = 0; p < this.capacity; p++) {
            if (!alive[p]) continue;
            let nvx = vx[p] + fx[p] * dt;
            let nvy = vy[p] + fy[p] * dt;
            const speed2 = nvx * nvx + nvy * nvy;
            if (speed2 > MAX_SPEED * MAX_SPEED) {
                const s = MAX_SPEED / Math.sqrt(speed2);
                nvx *= s;
                nvy *= s;
            }
            vx[p] = nvx;
            vy[p] = nvy;
            px[p] += nvx * dt;
            py[p] += nvy * dt;
        }
    }

    _handleBoundaries() {
        const { px, py, vx, vy, alive, terrain } = this;
        for (let p = 0; p < this.capacity; p++) {
            if (!alive[p]) continue;
            // Lateral walls of the grid
            if (px[p] < 0.05) { px[p] = 0.05; if (vx[p] < 0) vx[p] = -vx[p] * 0.3; }
            if (px[p] > GRID_W - 0.05) { px[p] = GRID_W - 0.05; if (vx[p] > 0) vx[p] = -vx[p] * 0.3; }
            // Top wall (upstream end): soft wall
            if (py[p] < 0.05) { py[p] = 0.05; if (vy[p] < 0) vy[p] = -vy[p] * 0.3; }
            // Bottom: remove if past the ocean
            if (py[p] > GRID_H - 0.1) {
                this._kill(p);
            }
        }
    }

    // Spawn particles at the spring at the top of the stream.
    // Streams emerge from a pool slightly inside the top edge.
    spawnFromSpring(dt) {
        this.spawnAccumulator += SPAWN_PER_SEC * dt;
        const toSpawn = Math.floor(this.spawnAccumulator);
        if (toSpawn <= 0) return;
        this.spawnAccumulator -= toSpawn;
        const cx = this.terrain.streamCenter[1];
        for (let i = 0; i < toSpawn; i++) {
            if (this.count >= this.capacity - 2) break;
            const x = cx + (Math.random() - 0.5) * 1.4;
            const y = 0.5 + Math.random() * 1.1;
            const vx = (Math.random() - 0.5) * SPAWN_JITTER;
            const vy = 1.0 + Math.random() * 0.8;
            this._spawn(x, y, vx, vy);
        }
    }

    reset() {
        for (let p = 0; p < this.capacity; p++) {
            if (this.alive[p]) this._kill(p);
        }
    }
}

// Very rough estimate of "water column height" from local particle density.
// Used to decide when water overtops a wall.
function pileHeightFromDensity(density) {
    const t = Math.max(0, density / REST_DENSITY - 1);
    return Math.min(1.8, t * 0.9);
}
