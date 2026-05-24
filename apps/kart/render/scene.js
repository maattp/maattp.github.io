// Renderer + scene + sky + lights + ground. Bright cartoon look: a gradient sky
// dome, a warm sun that casts soft shadows (the single biggest "this looks real"
// win), and a striped mown-lawn ground. Pure presentation — never mutates sim.

import * as THREE from 'three';
import { COLORS, TERRAIN } from '../config.js';
import { heightAt } from '../simulation/terrain.js';
import { toonMat } from './materials.js';

export class Stage {
    constructor(canvas, tier) {
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: tier.antialias,
            powerPreference: 'high-performance',
        });
        this.renderer.setPixelRatio(tier.pixelRatio);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(COLORS.fog, 170, 480);

        this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
        this.camera.position.set(0, 6, -10);

        this._addSky();
        this._addLights(tier);
        this._addGround();
    }

    _addSky() {
        const geo = new THREE.SphereGeometry(480, 32, 16);
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
                top: { value: new THREE.Color(COLORS.skyTop) },
                bottom: { value: new THREE.Color(COLORS.skyBottom) },
            },
            vertexShader: /* glsl */`
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                varying vec3 vDir;
                uniform vec3 top;
                uniform vec3 bottom;
                void main() {
                    float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
                    t = pow(t, 0.75);
                    gl_FragColor = vec4(mix(bottom, top, t), 1.0);
                }
            `,
        });
        const sky = new THREE.Mesh(geo, mat);
        sky.frustumCulled = false;
        this.scene.add(sky);
    }

    _addLights(tier) {
        this.scene.add(new THREE.HemisphereLight(COLORS.skyTop, COLORS.grass, 0.95));

        const sun = new THREE.DirectionalLight(COLORS.sun, 1.35);
        sun.position.set(40, 90, 26);
        sun.castShadow = true;
        const sz = tier.shadowMap;
        sun.shadow.mapSize.set(sz, sz);
        // Tight frustum that follows the kart (see setSunFocus) so shadows stay
        // crisp anywhere on the large track instead of covering it all at once.
        const d = 40;
        sun.shadow.camera.left = -d;
        sun.shadow.camera.right = d;
        sun.shadow.camera.top = d;
        sun.shadow.camera.bottom = -d;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 220;
        sun.shadow.bias = -0.0006;
        sun.shadow.normalBias = 0.5;
        this.scene.add(sun);
        this.scene.add(sun.target);
        this.sun = sun;
        this._sunOffset = sun.position.clone();
    }

    // Keep the shadow frustum centred on the kart (including its height on hills).
    setSunFocus(x, y, z) {
        this.sun.target.position.set(x, y, z);
        this.sun.position.set(x + this._sunOffset.x, y + this._sunOffset.y, z + this._sunOffset.z);
    }

    _addGround() {
        // Displaced terrain mesh: a grid whose vertices are lifted by heightAt so
        // the ground matches the simulation's heightfield exactly.
        const size = TERRAIN.extent * 2;
        const seg = Math.max(8, Math.round(size / TERRAIN.meshStep));
        const geo = new THREE.PlaneGeometry(size, size, seg, seg);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            // sit the background terrain slightly below the true surface so the
            // draped road/verge always cover it and the coarse mesh can't poke
            // through near the walls
            pos.setY(i, heightAt(x, z) - 0.18);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        const mat = toonMat(0xffffff, { map: stripedLawn() });
        this.ground = new THREE.Mesh(geo, mat);
        this.ground.receiveShadow = true;
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
}

// Canvas texture of alternating green stripes -> mown-lawn / golf-course look.
function stripedLawn() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const a = '#' + COLORS.grass.toString(16).padStart(6, '0');
    const b = '#' + COLORS.grassDark.toString(16).padStart(6, '0');
    for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? a : b;
        ctx.fillRect(0, (i / 8) * size, size, size / 8);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(60, 60);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}
