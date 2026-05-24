// Renderer + scene + lights + ground plane. Pure presentation: it reads the
// simulation's state but never changes it. Keeping all Three.js behind render/*
// means the simulation stays portable.

import * as THREE from 'three';
import { COLORS } from '../config.js';

export class Stage {
    constructor(canvas, tier) {
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: tier.antialias,
            powerPreference: 'high-performance',
        });
        this.renderer.setPixelRatio(tier.pixelRatio);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = false;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(COLORS.sky);
        this.scene.fog = new THREE.Fog(COLORS.fog, 90, 320);

        this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 600);
        this.camera.position.set(0, 6, -10);

        // lighting — flat and bright; art doesn't matter this milestone
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6a3a, 1.0));
        const sun = new THREE.DirectionalLight(0xffffff, 1.1);
        sun.position.set(40, 80, 30);
        this.scene.add(sun);

        // ground (grass) — large plane under everything
        const groundGeo = new THREE.PlaneGeometry(1200, 1200);
        groundGeo.rotateX(-Math.PI / 2);
        const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.grass });
        this.ground = new THREE.Mesh(groundGeo, groundMat);
        this.ground.position.y = -0.02;
        this.scene.add(this.ground);
    }

    setSize(w, h) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    setFov(fov) {
        if (Math.abs(this.camera.fov - fov) > 0.01) {
            this.camera.fov = fov;
            this.camera.updateProjectionMatrix();
        }
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
