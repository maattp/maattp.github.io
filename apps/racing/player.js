// The player's craft. Its angular position around the tube is game state held
// in main.js (the *world* rotates to put the craft at the bottom of the
// screen). This module only owns the craft's *appearance*: a faceted anti-grav
// racer at a fixed spot just inside the wall that banks into turns, flares its
// engines with speed/boost, and strobes during post-crash invulnerability.
//
// The hull is a low-poly octahedral dart (sharp nose forward, faceted body),
// with a tinted glass canopy, a swept delta wing, twin engine pods, and glowing
// neon edge trim that pops under the bloom pass — Wipeout / F-Zero styling.

import * as THREE from 'three';
import { CRAFT_RADIUS, PLAYER_Z, COL_CRAFT, COL_CRAFT_GLOW } from './config.js';

const TRIM_COLOR = 0x6cf3ff;

export class Player {
    constructor() {
        this.group = new THREE.Group();
        this.group.position.set(0, -CRAFT_RADIUS, PLAYER_Z);

        const hullMat = new THREE.MeshStandardMaterial({
            color: COL_CRAFT,
            metalness: 0.9,
            roughness: 0.32,
            emissive: new THREE.Color(COL_CRAFT_GLOW),
            emissiveIntensity: 0.16,
            flatShading: true,
        });
        const wingMat = new THREE.MeshStandardMaterial({
            color: 0xaab8d6,
            metalness: 0.85,
            roughness: 0.42,
            flatShading: true,
        });
        const podMat = new THREE.MeshStandardMaterial({
            color: 0x2a3038,
            metalness: 0.8,
            roughness: 0.5,
        });
        const trimMat = new THREE.LineBasicMaterial({ color: TRIM_COLOR });

        // ---- fuselage: an octahedron stretched into a sharp dart (nose -Z) ----
        const hullGeo = new THREE.OctahedronGeometry(1, 0);
        hullGeo.scale(0.52, 0.34, 1.5);
        const hull = new THREE.Mesh(hullGeo, hullMat);
        this.group.add(hull);
        hull.add(new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo, 1), trimMat));

        // ---- glass canopy: a low tinted dome over the front-top ----
        const canopyGeo = new THREE.SphereGeometry(0.25, 18, 12);
        canopyGeo.scale(1.0, 0.7, 1.8);
        const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({
            color: 0x0a1622,
            metalness: 0.5,
            roughness: 0.08,
            emissive: new THREE.Color(0x1b4a7a),
            emissiveIntensity: 0.5,
        }));
        canopy.position.set(0, 0.17, -0.28);
        this.group.add(canopy);

        // ---- swept delta wing (arrowhead with a twin-tail notch) ----
        const wingShape = new THREE.Shape();
        wingShape.moveTo(0, -1.1);     // nose apex (forward)
        wingShape.lineTo(1.02, 0.82);  // right tip
        wingShape.lineTo(0.34, 0.56);  // inner right (notch)
        wingShape.lineTo(-0.34, 0.56); // inner left (notch)
        wingShape.lineTo(-1.02, 0.82); // left tip
        wingShape.closePath();
        const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.12, bevelEnabled: false });
        wingGeo.translate(0, 0, -0.06);
        wingGeo.rotateX(Math.PI / 2);  // lay flat: shape-y -> world -z (forward), depth -> world y
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.position.set(0, -0.05, 0.18);
        this.group.add(wing);
        wing.add(new THREE.LineSegments(new THREE.EdgesGeometry(wingGeo, 20), trimMat));

        // ---- twin engine pods + glowing exhausts at the tail (+Z) ----
        this.engineMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: new THREE.Color(0x49e9ff),
            emissiveIntensity: 2.6,
            metalness: 0.1,
            roughness: 0.5,
        });
        this.engines = [];
        for (const sx of [-1, 1]) {
            const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.6, 14), podMat);
            pod.rotation.x = Math.PI / 2;     // align length with Z
            pod.position.set(sx * 0.34, -0.02, 1.0);
            this.group.add(pod);

            const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.22, 14), this.engineMat);
            exhaust.rotation.x = Math.PI / 2; // local Y (height) -> world Z, so scale.y = flare
            exhaust.position.set(sx * 0.34, -0.02, 1.32);
            this.group.add(exhaust);
            this.engines.push(exhaust);
        }

        // Soft additive glow sprite trailing the engines.
        const glowTex = makeGlowTexture();
        this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTex,
            color: 0x49e9ff,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
        }));
        this.glow.scale.set(3.0, 3.0, 1);
        this.glow.position.set(0, -0.02, 1.7);
        this.group.add(this.glow);

        // A light that travels with the craft so the tunnel near it reads.
        this.light = new THREE.PointLight(COL_CRAFT_GLOW, 14, 26, 2.0);
        this.light.position.set(0, 0.4, 0);
        this.group.add(this.light);

        this._bank = 0;
        this._bob = Math.random() * 10;
    }

    // steer: -1..1 (current smoothed steering), boost: 0..1, speed01: 0..1,
    // invuln>0 means flashing i-frames, dt seconds, time seconds.
    update(dt, { steer, boost, speed01, invuln, time, alive }) {
        // Bank into the spin; the craft leans the way it's rotating.
        const targetBank = -steer * 0.6;
        this._bank += (targetBank - this._bank) * Math.min(1, dt * 8);
        this.group.rotation.z = this._bank;
        // slight nose pitch with speed for a planted feel
        this.group.rotation.x = -speed01 * 0.06;

        // Idle hover bob (mostly visible on the start screen).
        this._bob += dt;
        const hover = alive ? 0 : Math.sin(this._bob * 1.6) * 0.18;
        this.group.position.y = -CRAFT_RADIUS + hover;

        // Engine flare scales with speed and punches on boost.
        const flare = 0.7 + speed01 * 0.9 + boost * 1.8;
        for (const e of this.engines) e.scale.y = flare;
        this.engineMat.emissiveIntensity = 2.2 + boost * 5.0;

        const glowScale = 2.4 + speed01 * 1.4 + boost * 3.2;
        this.glow.scale.set(glowScale, glowScale, 1);
        this.glow.material.opacity = 0.55 + boost * 0.45;
        this.glow.material.color.setHex(boost > 0.25 ? 0x39ff9e : 0x49e9ff);
        this.light.intensity = 10 + speed01 * 8 + boost * 22;

        // Invulnerability strobe.
        const flashing = invuln > 0 && Math.floor(time * 14) % 2 === 0;
        this.group.visible = !flashing;
    }

    reset() {
        this._bank = 0;
        this.group.rotation.set(0, 0, 0);
        this.group.visible = true;
    }
}

function makeGlowTexture() {
    const s = 64;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(160,240,255,0.8)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
