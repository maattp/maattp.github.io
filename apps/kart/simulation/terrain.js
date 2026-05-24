// Terrain heightfield. Pure analytic functions shared by the simulation (for
// vertical dynamics) and the renderer (to drape the world over the surface), so
// both agree exactly. No Three.js, no DOM — stays portable and deterministic.
//
// The surface is single-valued y = height(x, z): a sum of low-frequency waves
// (rolling hills) plus a few Gaussian bumps (local hills / ramps). Single-valued
// means no overlaps/bridges — that's the deliberate Level-2 scope.

import { TERRAIN } from '../config.js';

export function heightAt(x, z) {
    let h = 0;
    for (const w of TERRAIN.waves) {
        h += w.a * Math.sin(w.fx * x + w.px) * Math.cos(w.fz * z + w.pz);
    }
    for (const b of TERRAIN.bumps) {
        const dx = x - b.x, dz = z - b.z;
        h += b.a * Math.exp(-(dx * dx + dz * dz) / (2 * b.s * b.s));
    }
    return h;
}

// Analytic gradient (∂h/∂x, ∂h/∂z).
export function gradientAt(x, z) {
    let gx = 0, gz = 0;
    for (const w of TERRAIN.waves) {
        gx += w.a * w.fx * Math.cos(w.fx * x + w.px) * Math.cos(w.fz * z + w.pz);
        gz += w.a * Math.sin(w.fx * x + w.px) * (-w.fz * Math.sin(w.fz * z + w.pz));
    }
    for (const b of TERRAIN.bumps) {
        const dx = x - b.x, dz = z - b.z;
        const e = b.a * Math.exp(-(dx * dx + dz * dz) / (2 * b.s * b.s));
        gx += e * (-dx / (b.s * b.s));
        gz += e * (-dz / (b.s * b.s));
    }
    return { gx, gz };
}

// Unit surface normal (y-up). Useful for orienting meshes to the slope.
export function normalAt(x, z) {
    const { gx, gz } = gradientAt(x, z);
    const nx = -gx, ny = 1, nz = -gz;
    const l = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / l, y: ny / l, z: nz / l };
}
