// Static set dressing: chunky cartoon trees, distant rolling hills, and floating
// clouds. Scattered once at build time and never touched again. Trees avoid the
// drivable surface; hills sit far out in the fog for depth.

import * as THREE from 'three';
import { COLORS, VISUALS } from '../config.js';
import { toonMat } from './materials.js';

export function buildProps(track) {
    const group = new THREE.Group();
    group.add(trees(track));
    group.add(hills());
    group.add(clouds());
    return group;
}

function trees(track) {
    const g = new THREE.Group();
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.38, 1.6, 8);
    const trunkMat = toonMat(COLORS.treeTrunk);
    const leafGeoA = new THREE.ConeGeometry(1.5, 2.6, 9);
    const leafGeoB = new THREE.ConeGeometry(1.15, 2.0, 9);
    const leafMatA = toonMat(COLORS.treeLeaf);
    const leafMatB = toonMat(COLORS.treeLeaf2);

    let placed = 0, attempts = 0;
    while (placed < VISUALS.trees && attempts < VISUALS.trees * 12) {
        attempts++;
        const x = (Math.random() - 0.5) * 230;
        const z = (Math.random() - 0.5) * 230;
        if (track.isOnTrack(x, z)) continue;            // keep off the road
        const scale = 0.8 + Math.random() * 1.1;
        const t = new THREE.Group();
        // trees don't cast shadows (they'd be the bulk of shadow casters); the
        // kart, cones and banner shadows are enough to ground the scene.
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.8;
        t.add(trunk);
        const l1 = new THREE.Mesh(leafGeoA, leafMatA);
        l1.position.y = 2.4; t.add(l1);
        const l2 = new THREE.Mesh(leafGeoB, leafMatB);
        l2.position.y = 3.6; t.add(l2);
        t.position.set(x, 0, z);
        t.scale.setScalar(scale);
        t.rotation.y = Math.random() * Math.PI;
        g.add(t);
        placed++;
    }
    return g;
}

function hills() {
    const g = new THREE.Group();
    const mat = toonMat(COLORS.hill);
    for (let i = 0; i < VISUALS.hills; i++) {
        const a = (i / VISUALS.hills) * Math.PI * 2 + Math.random() * 0.3;
        const r = 200 + Math.random() * 80;
        const rad = 26 + Math.random() * 30;
        const hill = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 10), mat);
        hill.position.set(Math.cos(a) * r, -rad * 0.45, Math.sin(a) * r);
        hill.scale.y = 0.5;
        g.add(hill);
    }
    return g;
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
