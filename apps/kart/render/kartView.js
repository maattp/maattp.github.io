// Cartoon kart, built from primitives but with enough shapes (driver, helmet,
// hubcaps, spoiler, exhausts, antenna) to read as a real little vehicle. It adds
// feel on top of the sim: front wheels steer, all wheels spin with speed, the
// body leans into drifts, hops when a drift kicks off, squashes on boost, and an
// exhaust flame + ground glow flare up with the charge stage. Cosmetic only.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLORS, TUNING as T } from '../config.js';
import { toonMat } from './materials.js';

export class KartView {
    constructor() {
        this.group = new THREE.Group();

        this.bob = new THREE.Group();          // hop + squash
        this.group.add(this.bob);

        this.chassis = new THREE.Group();      // roll/lean
        this.bob.add(this.chassis);

        const bodyMat = toonMat(COLORS.kartBody);
        const accentMat = toonMat(COLORS.kartBody2);
        const darkMat = toonMat(COLORS.kartAccent);

        // low floor pan ties the body to the wheels (no floating gap)
        const floor = mesh(roundedBox(1.55, 0.3, 2.7, 0.12), darkMat);
        floor.position.y = 0.4;
        this.chassis.add(floor);

        // main tub
        const tub = mesh(roundedBox(1.4, 0.5, 1.9, 0.16), bodyMat);
        tub.position.y = 0.78;
        this.chassis.add(tub);

        // sloped nose
        const nose = mesh(roundedBox(1.2, 0.38, 1.05, 0.14), bodyMat);
        nose.position.set(0, 0.6, 1.55);
        this.chassis.add(nose);

        // side pods
        for (const sx of [-1, 1]) {
            const pod = mesh(roundedBox(0.42, 0.45, 1.7, 0.12), accentMat);
            pod.position.set(sx * 0.98, 0.5, 0.1);
            this.chassis.add(pod);
        }

        // seat + driver
        const seat = mesh(roundedBox(1.0, 0.5, 0.9, 0.12), darkMat);
        seat.position.set(0, 0.95, -0.5);
        this.chassis.add(seat);

        const torso = mesh(roundedBox(0.72, 0.72, 0.62, 0.16), toonMat(COLORS.helmet));
        torso.position.set(0, 1.32, -0.45);
        this.chassis.add(torso);

        const head = mesh(new THREE.SphereGeometry(0.32, 16, 12), toonMat(COLORS.driver));
        head.position.set(0, 1.78, -0.35);
        this.chassis.add(head);

        const helmet = mesh(new THREE.SphereGeometry(0.36, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), toonMat(COLORS.helmet));
        helmet.position.set(0, 1.82, -0.35);
        this.chassis.add(helmet);

        // steering wheel
        const wheelHub = mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 16), darkMat);
        wheelHub.position.set(0, 1.2, 0.35);
        wheelHub.rotation.x = Math.PI * 0.34;
        this.chassis.add(wheelHub);

        // rear spoiler
        const wing = mesh(roundedBox(1.65, 0.14, 0.5, 0.05), accentMat);
        wing.position.set(0, 1.25, -1.5);
        this.chassis.add(wing);
        for (const sx of [-0.62, 0.62]) {
            const strut = mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), darkMat);
            strut.position.set(sx, 0.98, -1.47);
            this.chassis.add(strut);
        }

        // exhausts + boost flame
        this.flames = [];
        for (const sx of [-0.4, 0.4]) {
            const pipe = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 10), darkMat);
            pipe.rotation.x = Math.PI / 2;
            pipe.position.set(sx, 0.72, -1.62);
            this.chassis.add(pipe);

            const flame = mesh(new THREE.ConeGeometry(0.16, 0.7, 10), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
            flame.rotation.x = -Math.PI / 2;
            flame.position.set(sx, 0.72, -2.02);
            flame.visible = false;
            this.chassis.add(flame);
            this.flames.push(flame);
        }

        // antenna with ball
        const ant = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), darkMat);
        ant.position.set(0.52, 1.4, -0.9);
        this.chassis.add(ant);
        const ball = mesh(new THREE.SphereGeometry(0.09, 10, 8), toonMat(COLORS.kartBody2));
        ball.position.set(0.52, 1.78, -0.9);
        this.chassis.add(ball);

        // wheels (front pair steer; all spin). Pivot y == radius so they sit
        // exactly on the ground.
        this.frontL = makeWheel(0.55); this.frontR = makeWheel(0.55);
        this.rearL = makeWheel(0.62); this.rearR = makeWheel(0.62);
        this.frontL.pivot.position.set(-0.98, 0.55, 1.15);
        this.frontR.pivot.position.set(0.98, 0.55, 1.15);
        this.rearL.pivot.position.set(-1.02, 0.62, -1.15);
        this.rearR.pivot.position.set(1.02, 0.62, -1.15);
        for (const w of [this.frontL, this.frontR, this.rearL, this.rearR]) this.bob.add(w.pivot);

        // shadow casters
        this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

        // ground charge glow
        const glowGeo = new THREE.CircleGeometry(1.7, 28);
        glowGeo.rotateX(-Math.PI / 2);
        this.glowMat = new THREE.MeshBasicMaterial({
            color: COLORS.driftStage[0], transparent: true, opacity: 0, depthWrite: false,
        });
        this.glow = mesh(glowGeo, this.glowMat);
        this.glow.position.y = 0.04;
        this.glow.castShadow = false;
        this.group.add(this.glow);

        this._wasDrifting = false;
        this._hopT = 0;
        this._spin = 0;
    }

    // r: interpolated render state. dt: real seconds since last frame.
    update(r, dt) {
        this.group.position.set(r.x, 0, r.z);
        this.group.rotation.y = r.heading;

        // drift hop on the rising edge of a drift
        if (r.drifting && !this._wasDrifting) this._hopT = 0.32;
        this._wasDrifting = r.drifting;
        let hop = 0;
        if (this._hopT > 0) {
            this._hopT = Math.max(0, this._hopT - dt);
            hop = Math.sin((1 - this._hopT / 0.32) * Math.PI) * T.kartDriftHop;
        }
        this.bob.position.y = hop;

        // boost squash
        const sq = r.boost * T.kartBoostSquash;
        this.bob.scale.set(1 - sq * 0.5, 1 - sq * 0.5, 1 + sq);

        // body lean into the slide
        this.chassis.rotation.z = -clamp(r.slip, -1, 1) * T.kartBodyRoll;

        // wheels: front steer, all spin with forward speed
        const steerAng = -r.steer * (T.wheelSteerMaxDeg * Math.PI / 180);
        this.frontL.pivot.rotation.y = steerAng;
        this.frontR.pivot.rotation.y = steerAng;
        this._spin += (r.speed || 0) * dt * 1.6;
        for (const w of [this.frontL, this.frontR, this.rearL, this.rearR]) w.tire.rotation.x = this._spin;

        // exhaust flame on boost
        const flameOn = r.boost > 0.05;
        for (const f of this.flames) {
            f.visible = flameOn;
            const s = 0.6 + r.boost * 1.1;
            f.scale.set(1, 1, s);
        }

        // ground charge glow / boost flare
        if (r.driftStage > 0) {
            this.glowMat.color.setHex(COLORS.driftStage[r.driftStage - 1]);
            this.glowMat.opacity = 0.4 + 0.22 * Math.sin(performance.now() * 0.02);
            this.glow.scale.setScalar(0.8 + r.driftStage * 0.12);
        } else if (r.boost > 0.01) {
            this.glowMat.color.setHex(COLORS.driftStage[Math.max(0, r.boostStage - 1)]);
            this.glowMat.opacity = 0.45 * r.boost;
            this.glow.scale.setScalar(1);
        } else {
            this.glowMat.opacity = 0;
        }
    }
}

function makeWheel(radius = 0.5) {
    const pivot = new THREE.Group();
    const tire = mesh(new THREE.CylinderGeometry(radius, radius, 0.42, 18), toonMat(COLORS.wheel));
    tire.rotation.z = Math.PI / 2; // roll axis -> X
    pivot.add(tire);
    for (const sx of [-1, 1]) {
        const cap = mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, 0.44, 12), toonMat(COLORS.hubcap));
        cap.rotation.z = Math.PI / 2;
        cap.position.x = sx * 0.005;
        tire.add(cap);
    }
    return { pivot, tire };
}

function mesh(geo, mat) { return new THREE.Mesh(geo, mat); }

function roundedBox(w, h, d, r) {
    return new RoundedBoxGeometry(w, h, d, 3, r);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
