// Assembles the 3D stage: renderer, scene, chase camera, lights, and the
// rotating world group that holds the tunnel + entities. Steering is a single
// rotation of that group about Z, which slides the craft to the bottom of the
// tube on screen while everything else spins around it.

import * as THREE from 'three';
import {
    TUBE_RADIUS, CRAFT_RADIUS, CAM_BACK, CAM_RISE, CAM_LOOK_AHEAD, CAM_LOOK_RISE,
    FOV_BASE, COL_FOG,
} from './config.js';
import { Tunnel } from './tunnel.js';
import { Player } from './player.js';
import { EntityField } from './entities.js';
import { Streaks } from './streaks.js';

export class Stage {
    constructor(canvas, tier) {
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: tier.antialias,
            powerPreference: 'high-performance',
        });
        this.renderer.setPixelRatio(tier.pixelRatio);
        // Match the cortex app's proven pipeline: render linear with no tone
        // mapping, then let the composer's OutputPass do the sRGB encode. This
        // sidesteps double-tone-mapping issues with EffectComposer.
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(COL_FOG);
        this.scene.fog = new THREE.FogExp2(COL_FOG, 0.0052);

        this.camera = new THREE.PerspectiveCamera(FOV_BASE, 1, 0.1, 1200);
        this.camera.position.set(0, -CRAFT_RADIUS + CAM_RISE, CAM_BACK);
        this.camera.lookAt(0, -CRAFT_RADIUS + CAM_LOOK_RISE, -CAM_LOOK_AHEAD);

        // lights — mostly to shade the metallic craft; the world is emissive.
        this.scene.add(new THREE.HemisphereLight(0x8fb6ff, 0x1a0b2e, 0.7));
        const key = new THREE.DirectionalLight(0xbfe6ff, 0.9);
        key.position.set(2, 4, 6);
        this.scene.add(key);

        // rotating world
        this.worldGroup = new THREE.Group();
        this.scene.add(this.worldGroup);

        this.tunnel = new Tunnel();
        this.worldGroup.add(this.tunnel.mesh);

        this.entities = new EntityField();
        this.worldGroup.add(this.entities.group);

        this.player = new Player();
        this.scene.add(this.player.group);

        this.streaks = new Streaks(tier.streakCount);
        this.scene.add(this.streaks.points);
    }

    setSteerRotation(p) {
        // Put the craft (intrinsic angle p) at the bottom of the screen (-PI/2).
        this.worldGroup.rotation.z = -Math.PI / 2 - p;
    }

    setFov(fov) {
        if (Math.abs(this.camera.fov - fov) > 0.01) {
            this.camera.fov = fov;
            this.camera.updateProjectionMatrix();
        }
    }

    setSize(w, h) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }
}
