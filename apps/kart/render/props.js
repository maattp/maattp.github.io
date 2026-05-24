// Static set dressing. With the surrounding background terrain removed, the only
// scenery is floating clouds in the sky dome (the track itself, draped on the
// terrain heightfield, is the ground). Built once, never touched again.

import * as THREE from 'three';
import { COLORS, VISUALS } from '../config.js';

export function buildProps() {
    const group = new THREE.Group();
    group.add(clouds());
    return group;
}

function clouds() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.cloud, fog: false });
    for (let i = 0; i < VISUALS.clouds; i++) {
        const cloud = new THREE.Group();
        const puffs = 3 + Math.floor(Math.random() * 3);
        for (let p = 0; p < puffs; p++) {
            const r = 4 + Math.random() * 4;
            const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
            puff.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8);
            puff.scale.y = 0.6;
            cloud.add(puff);
        }
        const a = Math.random() * Math.PI * 2;
        const r = 80 + Math.random() * 160;
        cloud.position.set(Math.cos(a) * r, 45 + Math.random() * 35, Math.sin(a) * r);
        g.add(cloud);
    }
    return g;
}
