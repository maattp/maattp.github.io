import {
    GRID_W, GRID_H, TILE_W, TILE_H, HEIGHT_SCALE,
    OCEAN_ROW, STREAM_WIDTH,
    SAND_UNIT_H, STICK_UNIT_H, ROCK_UNIT_H,
} from './config.js';
import { computeCamera, project, unproject } from './isometric.js';

// Canvas 2D isometric renderer. Draws back-to-front:
//   1. sky/ocean horizon (background gradient)
//   2. terrain tiles (each cell as a filled diamond top + left/right side-walls)
//   3. rocks, sticks (sprites anchored on top of their cell)
//   4. water particles (depth-sorted by y)
//   5. debris
//   6. foam / splash overlays
// Performance notes: batch same-color fills using Path2D where possible.

export class Renderer {
    constructor(canvas, terrain, sph, erosion) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.terrain = terrain;
        this.sph = sph;
        this.erosion = erosion;
        this.dpr = 1;
        this.cam = { scale: 1, offsetX: 0, offsetY: 0 };
        this._splashes = [];
        this.resize();
    }

    resize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.dpr = dpr;
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.cam = computeCamera(w, h);
        this._cssW = w;
        this._cssH = h;
    }

    clientToWorld(cx, cy) {
        return unproject(cx, cy, this.cam);
    }

    addSplash(x, y, force) {
        this._splashes.push({
            x, y,
            life: 0,
            maxLife: 0.35 + Math.random() * 0.25,
            r: 0.15,
            maxR: 0.5 + Math.min(force * 0.08, 0.7),
        });
    }

    draw() {
        const ctx = this.ctx;
        const w = this._cssW;
        const h = this._cssH;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        // 1. Background: beach → sky gradient
        this._drawBackground(ctx, w, h);

        // 2. Ocean horizon (behind terrain because terrain is in front due to iso)
        // Skipped: ocean tiles at the far/front render with terrain.

        // 3. Terrain tiles
        this._drawTerrain(ctx);

        // 4. Water particles and debris (depth-sorted)
        this._drawWaterAndDebris(ctx);

        // 5. Ocean waves at the front of the beach (last few rows overlay)
        this._drawOceanFoam(ctx);

        // 6. Splashes fade
        this._drawSplashes(ctx);
    }

    _drawBackground(ctx, w, h) {
        const grd = ctx.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, '#a8d8f2');      // soft sky
        grd.addColorStop(0.45, '#e8d3a1');   // distant sand
        grd.addColorStop(1.0, '#d9b77f');    // warm foreground sand
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
    }

    _drawTerrain(ctx) {
        const { terrain, cam } = this;
        const { w: W, h: H } = terrain;
        // Iterate back-to-front (smaller i+j first) so later draws overlap earlier ones.
        // To save work, precompute screen positions.
        const hw = TILE_W * 0.5 * cam.scale;
        const hh = TILE_H * 0.5 * cam.scale;
        const hs = HEIGHT_SCALE * cam.scale;

        for (let j = 0; j < H; j++) {
            for (let i = 0; i < W; i++) {
                const k = j * W + i;
                const base = terrain.base[k];
                const sand = terrain.sand[k];
                const rocks = terrain.rockCells[k];
                const sticks = terrain.stickCells[k];
                const e = base + sand
                        + (rocks ? rocks.length * ROCK_UNIT_H : 0)
                        + (sticks ? sticks.length * STICK_UNIT_H : 0);

                const p = project(i + 0.5, j + 0.5, e, cam);
                const sx = p.sx, sy = p.sy;

                // Draw side-walls going down to elevation=0 (rough cliff sides)
                this._drawTileSides(ctx, i, j, e, hw, hh, hs);

                // Top diamond: sand color (warmer where sand is thick, cooler where raw stream)
                const u = (j - i) * 0.5;
                const sCoord = (i + j) * 0.5;
                const meander = Math.sin(sCoord * 0.2) * 1.6;
                const isStreamBed = Math.abs(u - meander) < STREAM_WIDTH * 0.9 && e < 0.1;
                this._drawTileTop(ctx, sx, sy, hw, hh, e, sand, isStreamBed, terrain.flowMag[k]);

                // Materials
                if (sticks) {
                    for (let s = 0; s < sticks.length; s++) {
                        const stick = sticks[s];
                        const sh = sand + s * STICK_UNIT_H + (rocks ? rocks.length * ROCK_UNIT_H : 0);
                        this._drawStick(ctx, i, j, stick, base + sh, cam);
                    }
                }
                if (rocks) {
                    for (let s = 0; s < rocks.length; s++) {
                        const rock = rocks[s];
                        const sh = sand + (sticks ? sticks.length * STICK_UNIT_H : 0) + s * ROCK_UNIT_H;
                        this._drawRock(ctx, i, j, rock, base + sh, cam);
                    }
                }
            }
        }
    }

    _drawTileSides(ctx, i, j, e, hw, hh, hs) {
        const { cam } = this;
        // Right side (facing +x +y): visible when tile is raised
        const top = project(i + 1, j, e, cam);
        const topBack = project(i + 1, j + 1, e, cam);
        const botBack = project(i + 1, j + 1, 0, cam);
        const bot = project(i + 1, j, 0, cam);
        if (e > 0.02) {
            ctx.fillStyle = this._sandShade(e, -0.15);
            ctx.beginPath();
            ctx.moveTo(top.sx, top.sy);
            ctx.lineTo(topBack.sx, topBack.sy);
            ctx.lineTo(botBack.sx, botBack.sy);
            ctx.lineTo(bot.sx, bot.sy);
            ctx.closePath();
            ctx.fill();
        }

        // Front-left side (facing +y, toward camera's left)
        const l1 = project(i, j + 1, e, cam);
        const l2 = project(i + 1, j + 1, e, cam);
        const l3 = project(i + 1, j + 1, 0, cam);
        const l4 = project(i, j + 1, 0, cam);
        if (e > 0.02) {
            ctx.fillStyle = this._sandShade(e, -0.25);
            ctx.beginPath();
            ctx.moveTo(l1.sx, l1.sy);
            ctx.lineTo(l2.sx, l2.sy);
            ctx.lineTo(l3.sx, l3.sy);
            ctx.lineTo(l4.sx, l4.sy);
            ctx.closePath();
            ctx.fill();
        }
    }

    _sandShade(e, brightnessDelta = 0) {
        // Higher elevation = warmer light sand; lower = wetter/darker
        const t = Math.max(0, Math.min(1, (e + 0.5) / 3.5));
        const r = Math.floor((228 + t * 12) * (1 + brightnessDelta));
        const g = Math.floor((196 + t * 14) * (1 + brightnessDelta));
        const b = Math.floor((140 + t * 10) * (1 + brightnessDelta));
        return `rgb(${clamp8(r)},${clamp8(g)},${clamp8(b)})`;
    }

    _drawTileTop(ctx, sx, sy, hw, hh, e, sand, isStreamBed, flowMag) {
        // Diamond corners
        ctx.beginPath();
        ctx.moveTo(sx, sy - hh);
        ctx.lineTo(sx + hw, sy);
        ctx.lineTo(sx, sy + hh);
        ctx.lineTo(sx - hw, sy);
        ctx.closePath();
        let fill;
        if (isStreamBed) {
            // Wet stream bed: darker, mossy
            fill = '#8b7147';
        } else if (e < -0.2) {
            // Submerged (ocean approach)
            const t = Math.min(1, -e / 1.5);
            fill = `rgb(${80 - t * 20},${120 - t * 20},${140 - t * 10})`;
        } else {
            fill = this._sandShade(e, 0);
        }
        ctx.fillStyle = fill;
        ctx.fill();

        // Sand grain shimmer on top of thick sand piles
        if (sand > 0.2) {
            ctx.fillStyle = `rgba(255, 240, 200, ${Math.min(0.25, sand * 0.12)})`;
            ctx.fill();
        }
    }

    _drawRock(ctx, i, j, rock, elev, cam) {
        const wx = i + 0.5 + rock.offX;
        const wy = j + 0.5 + rock.offY;
        const p = project(wx, wy, elev, cam);
        const r = rock.size * cam.scale * 16;
        const tone = rock.tone;
        const grd = ctx.createRadialGradient(p.sx - r * 0.3, p.sy - r * 0.3, r * 0.1, p.sx, p.sy, r);
        grd.addColorStop(0, `rgb(${180 * tone},${180 * tone},${180 * tone})`);
        grd.addColorStop(1, `rgb(${70 * tone},${70 * tone},${70 * tone})`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, r, r * 0.78, rock.angle, 0, Math.PI * 2);
        ctx.fill();
        // Tiny highlight
        ctx.fillStyle = `rgba(255,255,255,0.25)`;
        ctx.beginPath();
        ctx.ellipse(p.sx - r * 0.35, p.sy - r * 0.4, r * 0.25, r * 0.1, rock.angle, 0, Math.PI * 2);
        ctx.fill();
    }

    _drawStick(ctx, i, j, stick, elev, cam) {
        const wx = i + 0.5 + stick.offX;
        const wy = j + 0.5 + stick.offY;
        const p = project(wx, wy, elev, cam);
        const len = stick.length * cam.scale * TILE_W * 0.9;
        const thick = cam.scale * 3.5;
        const tone = stick.tone;
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(stick.angle);
        const grd = ctx.createLinearGradient(0, -thick, 0, thick);
        grd.addColorStop(0, `rgb(${170 * tone},${110 * tone},${60 * tone})`);
        grd.addColorStop(1, `rgb(${90 * tone},${55 * tone},${25 * tone})`);
        ctx.fillStyle = grd;
        roundRect(ctx, -len * 0.5, -thick * 0.5, len, thick, thick * 0.5);
        ctx.fill();
        // knots
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(-len * 0.3, -thick * 0.5, thick * 0.3, thick);
        ctx.fillRect(len * 0.18, -thick * 0.5, thick * 0.3, thick);
        ctx.restore();
    }

    _drawWaterAndDebris(ctx) {
        const { sph, cam, erosion } = this;
        const { px, py, alive, capacity } = sph;

        // Collect alive particles, sorted by depth key for correct iso layering
        if (!this._sortPairs) this._sortPairs = [];
        const pairs = this._sortPairs;
        pairs.length = 0;
        for (let p = 0; p < capacity; p++) {
            if (!alive[p]) continue;
            pairs.push([p, px[p] + py[p]]);
        }
        pairs.sort((a, b) => a[1] - b[1]);

        // Merge debris into depth-sorted sequence with water particles
        const debris = erosion.debris.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
        let dIdx = 0;
        for (let k = 0; k < pairs.length; k++) {
            const key = pairs[k][1];
            while (dIdx < debris.length && (debris[dIdx].x + debris[dIdx].y) < key) {
                this._drawDebrisItem(ctx, debris[dIdx], cam);
                dIdx++;
            }
            this._drawWaterParticle(ctx, pairs[k][0], cam);
        }
        while (dIdx < debris.length) {
            this._drawDebrisItem(ctx, debris[dIdx], cam);
            dIdx++;
        }
    }

    _drawWaterParticle(ctx, p, cam) {
        const { px, py, vx, vy, density } = this.sph;
        const e = this.terrain.elevationAt(px[p], py[p]);
        const pileH = Math.min(1.4, Math.max(0, density[p] / 3.2 - 1) * 0.7);
        const s = project(px[p], py[p], e + pileH, cam);
        const speed = Math.sqrt(vx[p] * vx[p] + vy[p] * vy[p]);
        const r = Math.max(4.2, 9 * cam.scale);
        const bright = Math.min(1, speed / 9);
        const cr = Math.floor(45 + bright * 140);
        const cg = Math.floor(125 + bright * 90);
        const cb = Math.floor(200 + bright * 45);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.88)`;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
        ctx.fill();
        if (speed > 3.5) {
            ctx.fillStyle = `rgba(255,255,255,${Math.min(0.45, speed * 0.04)})`;
            ctx.beginPath();
            ctx.arc(s.sx - r * 0.3, s.sy - r * 0.4, r * 0.38, 0, Math.PI * 2);
            ctx.fill();
        }
        if (speed > 3.5) {
            ctx.fillStyle = `rgba(255,255,255,${Math.min(0.4, speed * 0.035)})`;
            ctx.beginPath();
            ctx.arc(s.sx - r * 0.3, s.sy - r * 0.4, r * 0.35, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    _drawDebrisItem(ctx, d, cam) {
        const p = project(d.x, d.y, d.elevZ, cam);
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(d.angle);
        if (d.kind === 'rock') {
            const r = d.size * cam.scale * 16;
            const grd = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
            grd.addColorStop(0, `rgb(${160 * d.tone},${160 * d.tone},${160 * d.tone})`);
            grd.addColorStop(1, `rgb(${60 * d.tone},${60 * d.tone},${60 * d.tone})`);
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.ellipse(0, 0, r, r * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
        } else {
            const len = d.length * cam.scale * TILE_W * 0.9;
            const thick = cam.scale * 3.5;
            ctx.fillStyle = `rgb(${140 * d.tone},${85 * d.tone},${45 * d.tone})`;
            roundRect(ctx, -len * 0.5, -thick * 0.5, len, thick, thick * 0.5);
            ctx.fill();
        }
        ctx.restore();
    }

    _drawOceanFoam(ctx) {
        // Ocean sits at the high-(i+j) corner in diagonal-stream coords.
        const { cam } = this;
        const t = performance.now() * 0.0012;
        const threshold = (GRID_W + GRID_H) - 6; // (i+j) >= this means "ocean"
        const hw = TILE_W * 0.5 * cam.scale;
        const hh = TILE_H * 0.5 * cam.scale;
        for (let j = 0; j < GRID_H; j++) {
            for (let i = 0; i < GRID_W; i++) {
                if (i + j < threshold) continue;
                const oT = Math.min(1, ((i + j) - threshold) / 6);
                const p = project(i + 0.5, j + 0.5,
                    Math.sin(i * 0.5 + t + j * 0.2) * 0.05 - 0.15, cam);
                ctx.fillStyle = `rgba(110,170,200,${0.5 + oT * 0.25})`;
                ctx.beginPath();
                ctx.moveTo(p.sx, p.sy - hh);
                ctx.lineTo(p.sx + hw, p.sy);
                ctx.lineTo(p.sx, p.sy + hh);
                ctx.lineTo(p.sx - hw, p.sy);
                ctx.closePath();
                ctx.fill();
                // Foam at the first shore line
                if (Math.abs((i + j) - threshold) < 1) {
                    const foam = 0.35 + 0.25 * Math.sin((i + j) + t * 2.5);
                    ctx.fillStyle = `rgba(255,255,255,${foam})`;
                    ctx.beginPath();
                    ctx.ellipse(p.sx, p.sy - hh * 0.3, hw * 0.7, hh * 0.4, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }

    _drawSplashes(ctx) {
        for (let i = this._splashes.length - 1; i >= 0; i--) {
            const s = this._splashes[i];
            s.life += 1 / 60;
            if (s.life > s.maxLife) {
                this._splashes.splice(i, 1);
                continue;
            }
            const t = s.life / s.maxLife;
            s.r = s.maxR * t;
            const p = project(s.x, s.y, 0, this.cam);
            ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - t)})`;
            ctx.lineWidth = 2 * this.cam.scale;
            ctx.beginPath();
            ctx.ellipse(p.sx, p.sy, s.r * TILE_W * this.cam.scale * 0.5,
                s.r * TILE_H * this.cam.scale * 0.5, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function clamp8(v) { return Math.max(0, Math.min(255, v | 0)); }
