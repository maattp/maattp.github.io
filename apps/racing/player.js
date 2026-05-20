// The player's craft. Its angular position around the tube is game state held
// in main.js (the *world* rotates to put the craft at the bottom of the
// screen). This module only owns the craft's *appearance*: a low-poly hull at
// a fixed spot just inside the wall that banks into turns, pulses its thruster
// with speed/boost, and strobes during post-crash invulnerability.

import * as THREE from 'three';
import { CRAFT_RADIUS, PLAYER_Z, COL_CRAFT, COL_CRAFT_GLOW } from './config.js';

export class Player {
    constructor() {
        this.group = new THREE.Group();
        this.group.position.set(0, -CRAFT_RADIUS, PLAYER_Z);

        const hullMat = new THREE.MeshStandardMaterial({
            color: COL_CRAFT,
            metalness: 0.85,
            roughness: 0.28,
            emissive: new THREE.Color(COL_CRAFT_GLOW),
            emissiveIntensity: 0.22,
        });
        const trimMat = new THREE.MeshStandardMaterial({
            color: COL_CRAFT_GLOW,
            metalness: 0.4,
            roughness: 0.3,
            emissive: new THREE.Color(COL_CRAFT_GLOW),
            emissiveIntensity: 2.4,
        });

        // Main fuselage: a stretched, tapered wedge pointing forward (-Z).
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.6, 4), hullMat);
        body.rotation.x = -Math.PI / 2;   // point the cone down -Z
        body.rotation.z = Math.PI / 4;    // diamond cross-section
        body.scale.set(1.0, 0.5, 1.0);    // flatten it
        this.group.add(body);

        // Swept wings.
        const wingGeo = new THREE.BoxGeometry(1.9, 0.08, 0.7);
        const wing = new THREE.Mesh(wingGeo, hullMat);
        wing.position.z = 0.55;
        this.group.add(wing);
        const wingTrim = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.12), trimMat);
        wingTrim.position.set(0, 0.02, 0.9);
        this.group.add(wingTrim);

        // Glowing thruster block at the tail (+Z).
        this.thruster = new THREE.Mesh(
            new THREE.CylinderGeometry(0.26, 0.16, 0.5, 12),
            new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: new THREE.Color(0x49e9ff),
                emissiveIntensity: 3.0,
                metalness: 0.1, roughness: 0.5,
            }),
        );
        this.thruster.rotation.x = Math.PI / 2;
        this.thruster.position.z = 1.15;
        this.group.add(this.thruster);

        // Soft additive glow sprite trailing the engine.
        const glowTex = makeGlowTexture();
        this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTex,
            color: 0x49e9ff,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
        }));
        this.glow.scale.set(3.2, 3.2, 1);
        this.glow.position.z = 1.7;
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

        // Thruster flare scales with speed and punches on boost.
        const flare = 0.7 + speed01 * 0.8 + boost * 1.6;
        this.thruster.scale.set(1, flare, 1);
        this.thruster.material.emissiveIntensity = 2.2 + boost * 5.0;
        const glowScale = 2.6 + speed01 * 1.4 + boost * 3.2;
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
