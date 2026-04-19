import { TILE_W, TILE_H, HEIGHT_SCALE, GRID_W, GRID_H, CAM_MARGIN } from './config.js';

// Convert world (x, y, elev) -> screen pixels (before camera offset/scale).
// World X is lateral (0..GRID_W), world Y is downstream (0..GRID_H).
export function worldToScreenUnscaled(x, y, elev = 0) {
    const sx = (x - y) * TILE_W * 0.5;
    const sy = (x + y) * TILE_H * 0.5 - elev * HEIGHT_SCALE;
    return { sx, sy };
}

// Inverse: screen (sx, sy) with elev=0 -> world (x, y). Used for input.
export function screenToWorldFlat(sx, sy) {
    const a = sx / (TILE_W * 0.5);
    const b = sy / (TILE_H * 0.5);
    const x = (a + b) * 0.5;
    const y = (b - a) * 0.5;
    return { x, y };
}

// Computes camera parameters (offsetX, offsetY, scale) so the grid fills `w x h`.
export function computeCamera(canvasW, canvasH) {
    // Corners of flat grid
    const corners = [
        worldToScreenUnscaled(0, 0),
        worldToScreenUnscaled(GRID_W, 0),
        worldToScreenUnscaled(0, GRID_H),
        worldToScreenUnscaled(GRID_W, GRID_H),
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of corners) {
        if (c.sx < minX) minX = c.sx;
        if (c.sx > maxX) maxX = c.sx;
        if (c.sy < minY) minY = c.sy;
        if (c.sy > maxY) maxY = c.sy;
    }
    // Allow headroom for stacked materials rising up
    const headroom = 8 * HEIGHT_SCALE;
    minY -= headroom;
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    const scale = Math.min(
        (canvasW - CAM_MARGIN * 2) / worldW,
        (canvasH - CAM_MARGIN * 2) / worldH,
    );
    const offsetX = canvasW * 0.5 - (minX + worldW * 0.5) * scale;
    const offsetY = canvasH * 0.5 - (minY + worldH * 0.5) * scale;
    return { scale, offsetX, offsetY };
}

// Full projection: world -> canvas pixels.
export function project(x, y, elev, cam) {
    const { sx, sy } = worldToScreenUnscaled(x, y, elev);
    return {
        sx: sx * cam.scale + cam.offsetX,
        sy: sy * cam.scale + cam.offsetY,
    };
}

// Canvas pixels -> world (flat, elev=0).
export function unproject(cx, cy, cam) {
    const sx = (cx - cam.offsetX) / cam.scale;
    const sy = (cy - cam.offsetY) / cam.scale;
    return screenToWorldFlat(sx, sy);
}
