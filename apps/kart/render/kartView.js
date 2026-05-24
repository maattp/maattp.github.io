// Visual kart, built from primitives (art doesn't matter this milestone). It
// reads an interpolated render state and adds feel: it leans into drifts,
// squashes forward on boost, and shows a charge glow whose colour tracks the
// drift stage. Purely cosmetic — no influence on the simulation.

import * as THREE from 'three';
import { COLORS, TUNING as T } from '../config.js';

export class KartView {
    constructor() {
        this.group = new THREE.Group();

        // body shell — a wedge-ish box so "forward" reads at a glance
        this.body = new THREE.Group();
        this.group.add(this.body);

        const chassis = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.5, 2.4),
            new THREE.MeshLambertMaterial({ color: COLORS.kartBody })
        );
        chassis.position.y = 0.45;
        this.body.add(chassis);

        const nose = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 0.35, 0.9),
            new THREE.MeshLambertMaterial({ color: COLORS.kartBody })
        );
        nose.position.set(0, 0.32, 1.4);
        this.body.add(nose);

        const seat = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.5, 0.9),
            new THREE.MeshLambertMaterial({ color: COLORS.kartAccent })
        );
        seat.position.set(0, 0.8, -0.4);
        this.body.add(seat);

        // wheels
        const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 14);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheelMat = new THREE.MeshLambertMaterial({ color: COLORS.wheel });
        const wheelPos = [
            [-0.85, 0.42, 1.0], [0.85, 0.42, 1.0],
            [-0.9, 0.42, -1.0], [0.9, 0.42, -1.0],
        ];
        for (const p of wheelPos) {
            const w = new THREE.Mesh(wheelGeo, wheelMat);
            w.position.set(p[0], p[1], p[2]);
            this.body.add(w);
        }

        // drift charge glow — a disc under the kart that brightens/colours by stage
        const glowGeo = new THREE.CircleGeometry(1.4, 24);
        glowGeo.rotateX(-Math.PI / 2);
        this.glowMat = new THREE.MeshBasicMaterial({
            color: COLORS.driftStage[0],
            transparent: true,
            opacity: 0,
            depthWrite: false,
        });
        this.glow = new THREE.Mesh(glowGeo, this.glowMat);
        this.glow.position.y = 0.05;
        this.group.add(this.glow);
    }

    // r: interpolated render state from main (position, heading, feel scalars)
    update(r) {
        this.group.position.set(r.x, 0, r.z);
        this.group.rotation.y = r.heading;

        // lean into the slide: roll proportional to lateral slip, biased by drift
        const roll = -clamp(r.slip, -1, 1) * T.kartBodyRoll;
        this.body.rotation.z = roll;

        // boost squash: stretch forward, flatten slightly
        const sq = r.boost * T.kartBoostSquash;
        this.body.scale.set(1 - sq * 0.5, 1 - sq * 0.5, 1 + sq);

        // drift charge glow
        if (r.driftStage > 0) {
            this.glowMat.color.setHex(COLORS.driftStage[r.driftStage - 1]);
            this.glowMat.opacity = 0.35 + 0.2 * Math.sin(performance.now() * 0.02);
        } else if (r.boost > 0.01) {
            this.glowMat.color.setHex(COLORS.driftStage[Math.max(0, r.boostStage - 1)]);
            this.glowMat.opacity = 0.4 * r.boost;
        } else {
            this.glowMat.opacity = 0;
        }
    }
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
