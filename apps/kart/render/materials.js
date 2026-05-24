// Shared cel-shading helpers. A MeshToonMaterial with a small stepped gradient
// map gives the flat banded look that reads as "cartoon" while still responding
// to lights and shadows. One gradient ramp is shared across every mesh.

import * as THREE from 'three';

let _grad = null;

export function toonGradient() {
    if (_grad) return _grad;
    // 4-step ramp: shadow -> mid -> light -> highlight
    const steps = new Uint8Array([90, 160, 215, 255]);
    _grad = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
    _grad.minFilter = THREE.NearestFilter;
    _grad.magFilter = THREE.NearestFilter;
    _grad.generateMipmaps = false;
    _grad.needsUpdate = true;
    return _grad;
}

export function toonMat(color, opts = {}) {
    return new THREE.MeshToonMaterial({
        color,
        gradientMap: toonGradient(),
        ...opts,
    });
}
