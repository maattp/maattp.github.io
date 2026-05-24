// The kart simulation. This is the core of the milestone and the part that must
// stay portable: `stepKart` is a PURE function of (previous state, input, dt,
// track) -> new state. It never touches the DOM, Three.js, or input devices, so
// the exact same code can later run on an authoritative host for multiplayer.
//
// Input is the small struct the rest of the game speaks:
//   { steer: -1..1, accelerate: bool, brake: bool, drift: bool }
//
// State is a flat plain object (cheap to clone, serialize, and interpolate):
//   x, z          world position on the ground plane
//   heading       yaw, radians (forward = (sin h, cos h))
//   vx, vz        world-space velocity
//   forwardSpeed  signed speed along heading (cached for HUD/render/feel)
//   steer         smoothed steer actually applied (-1..1)
//   drifting      bool
//   driftDir      -1 / +1 committed drift direction
//   driftCharge   seconds of continuous drift accumulated
//   driftStage    0..3 highest charge stage reached this drift
//   boostStage    0..3 stage of the active boost
//   boostTimer    seconds remaining on the active boost
//   onTrack       bool (last surface test)

import { TUNING as T } from '../config.js';

export function createKartState(pose) {
    return {
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        vx: 0,
        vz: 0,
        forwardSpeed: 0,
        grip: T.normalGrip,   // eased toward target grip for smooth drift onset
        steer: 0,
        drifting: false,
        driftDir: 0,
        driftCharge: 0,
        driftStage: 0,
        boostStage: 0,
        boostTimer: 0,
        onTrack: true,
    };
}

// Highest stage index (0..3) reached for a given accumulated drift charge.
function stageForCharge(charge) {
    const t = T.driftStageTimes;
    if (charge >= t[2]) return 3;
    if (charge >= t[1]) return 2;
    if (charge >= t[0]) return 1;
    return 0;
}

// Pure step. `prev` is not mutated.
export function stepKart(prev, input, dt, track) {
    const s = { ...prev };

    // ---- smooth the steer input (device/keyboard already gave us -1..1) ----
    const steerTarget = clamp(input.steer, -1, 1);
    s.steer += (steerTarget - s.steer) * Math.min(1, T.steerEase * dt);

    // ---- decompose world velocity into the kart's local frame (old heading) ----
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);   // forward
    const rx = Math.cos(s.heading), rz = -Math.sin(s.heading);  // right
    let vForward = s.vx * fx + s.vz * fz;
    let vLateral = s.vx * rx + s.vz * rz;

    // ---- surface + boost bookkeeping ----
    const onTrack = track.isOnTrack(s.x, s.z);
    s.onTrack = onTrack;
    if (s.boostTimer > 0) s.boostTimer = Math.max(0, s.boostTimer - dt);
    const boosting = s.boostTimer > 0;

    // ---- drift state machine ----
    const wantDrift = input.drift && input.accelerate;
    if (!s.drifting) {
        if (wantDrift && vForward > T.driftMinSpeed && Math.abs(s.steer) > T.driftSteerThreshold) {
            s.drifting = true;
            s.driftDir = s.steer >= 0 ? 1 : -1;
            s.driftCharge = 0;
            s.driftStage = 0;
        }
    } else {
        // keep drifting only while held and still moving with enough pace
        if (input.drift && vForward > T.driftMinSpeed * 0.6) {
            s.driftCharge += dt;
            s.driftStage = Math.max(s.driftStage, stageForCharge(s.driftCharge));
        } else {
            // release -> grant boost for the highest stage reached
            const stage = s.driftStage;
            if (stage > 0) {
                s.boostStage = stage;
                s.boostTimer = T.boostStageDuration[stage];
            }
            s.drifting = false;
            s.driftDir = 0;
            s.driftCharge = 0;
            s.driftStage = 0;
        }
    }

    // ---- longitudinal: acceleration curve, brake, coast, boost, off-track ----
    const boostBonus = boosting
        ? T.boostStageBonus[s.boostStage] * (s.boostTimer / T.boostStageDuration[s.boostStage])
        : 0;
    let target = T.topSpeed + boostBonus;
    let accelRate;
    if (onTrack) {
        if (input.accelerate) {
            accelRate = vForward < target ? T.accel : T.engineBrake;
        } else if (input.brake) {
            target = -T.reverseSpeed;
            accelRate = T.brakeStrength;
        } else {
            target = 0;
            accelRate = T.coastDrag;
        }
    } else {
        // grass: clamp hard toward a low ceiling regardless of throttle
        target = input.accelerate ? T.offTrackMaxSpeed : 0;
        accelRate = T.offTrackDrag;
    }
    vForward += (target - vForward) * Math.min(1, accelRate * dt);

    // ---- lateral grip (low while drifting / on grass = slide) ----
    // Ease the effective grip toward its target so starting/ending a drift slides
    // in gradually instead of snapping the kart sideways.
    let gripTarget = s.drifting ? T.driftGrip : T.normalGrip;
    if (!onTrack) gripTarget = Math.min(gripTarget, T.offTrackGrip);
    s.grip += (gripTarget - s.grip) * Math.min(1, T.gripEase * dt);
    vLateral += (0 - vLateral) * Math.min(1, s.grip * dt);

    // ---- recompose world velocity (still using current heading) ----
    s.vx = vForward * fx + vLateral * rx;
    s.vz = vForward * fz + vLateral * rz;
    s.forwardSpeed = vForward;

    // ---- steering: turn rate scales with speed; karts don't pivot in place ----
    const speedFrac = clamp(Math.abs(vForward) / T.topSpeed, 0, 1);
    let authority = clamp(speedFrac * T.steerSpeedGain, 0, 1);
    authority *= 1 - T.turnTopSpeedFalloff * speedFrac; // shave twitch at the very top
    let yawRate;
    if (s.drifting) {
        // additive control: gentle base pull in the drift direction + your steer.
        // countersteering subtracts, so you can tighten, hold a line, or straighten
        // out — clamped to a normal hard turn so it never spins you.
        const mult = clamp(s.driftDir * T.driftBaseYaw + s.steer * T.driftSteerAuthority, -1, 1);
        yawRate = mult * T.maxTurnRate * authority;
    } else {
        yawRate = s.steer * T.maxTurnRate * authority;
    }
    // reverse: steering inverts when actually rolling backwards (feels natural)
    if (vForward < 0) yawRate = -yawRate;
    s.heading += yawRate * dt;

    // ---- integrate position ----
    s.x += s.vx * dt;
    s.z += s.vz * dt;

    // ---- wall constraint: keep the kart's BODY (not just its centre) inside the
    // barrier and slide along it. Constraining the centre to wall - kartRadius
    // stops the body edge from clipping through, and projecting out only the
    // into-wall velocity component gives a smooth slide instead of a bounce. ----
    const conf = track.confine(s.x, s.z, track.wallHalfWidth - T.kartRadius);
    if (conf.hit) {
        s.x = conf.x;
        s.z = conf.z;
        const vOut = s.vx * conf.nx + s.vz * conf.nz; // velocity into the wall
        if (vOut > 0) {
            s.vx -= conf.nx * vOut * (1 + T.wallBounce);
            s.vz -= conf.nz * vOut * (1 + T.wallBounce);
            s.vx *= T.wallScrub;  // scrub a little speed on contact
            s.vz *= T.wallScrub;
        }
        // refresh cached forward speed after the correction
        s.forwardSpeed = s.vx * fx + s.vz * fz;
    }

    return s;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
