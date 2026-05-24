// Central tuning for the kart racer. EVERY feel-related number lives here so the
// driving model can be tweaked in one place. The simulation reads `TUNING`; the
// renderer reads `TUNING` + `COLORS`. Nothing in here imports anything — it is
// plain data so it can be shared with a future authoritative host.
//
// Units: distances are "world units" (roughly metres), speeds are units/second,
// turn rates are radians/second, times are seconds. The plane is XZ with +Y up.
//
// Coordinate convention used by the simulation:
//   heading 0  -> kart faces +Z. forward = (sin h, cos h), right = (cos h, -sin h)
//   positive `steer` (and positive heading delta) turns the kart to its right.

export const TUNING = {
    // ---------------------------------------------------------------- speed
    // Exponential eases: `vForward += (target - vForward) * rate * dt`. A higher
    // rate snaps harder. This doubles as the acceleration curve (fast off the
    // line, tapering as you approach top speed) and the boost bleed-off.
    topSpeed: 34,            // normal forward top speed (units/s)
    accel: 2.4,              // ramp-up rate toward target while accelerating
    engineBrake: 1.7,        // ramp-down rate when above target (how boost bleeds off)
    brakeStrength: 3.6,      // ramp rate toward 0 / reverse while braking
    coastDrag: 0.7,          // ramp toward 0 when neither accelerating nor braking
    reverseSpeed: 9,         // top reverse speed when holding brake from a stop

    // ---------------------------------------------------------------- steering
    // Turn authority scales with speed so the kart is sluggish when slow and
    // responsive at pace, and CANNOT pivot on the spot.
    maxTurnRate: 2.7,        // rad/s at full steer + full authority
    steerSpeedGain: 3.4,     // how fast authority climbs with speed (higher = reaches full sooner)
    turnTopSpeedFalloff: 0.18, // fraction of turn authority shed at very top speed (twitch guard)
    steerEase: 9.0,          // smoothing of raw steer input toward the target (-1..1)

    // ---------------------------------------------------------------- grip / slide
    // Lateral (sideways) velocity is bled off each step: `vLat += (0-vLat)*grip*dt`.
    // High grip = planted; low grip = the kart slides, which is what makes a drift
    // carve a wide arc.
    normalGrip: 9.0,
    driftGrip: 2.4,

    // ---------------------------------------------------------------- drift
    driftMinSpeed: 13,        // must be going at least this fast to start a drift
    driftSteerThreshold: 0.18,// must be turning at least this hard to start a drift
    // While drifting, yaw rate = baseTurnRate * (a multiplier between min and max,
    // chosen by how hard the player steers INTO the drift). Countersteering widens
    // the arc (min); steering hard inward tightens it (max).
    driftYawMin: 0.55,
    driftYawMax: 1.20,
    // Seconds of continuous drift needed to reach each charge stage.
    // [stage1 (blue), stage2 (orange), stage3 (purple)]
    driftStageTimes: [0.55, 1.30, 2.20],

    // ---------------------------------------------------------------- boost
    // Indexed by the highest stage reached when drift is released (0 = released
    // before stage 1 -> nothing). Boost adds a decaying bonus on top of topSpeed.
    boostStageBonus: [0, 8, 13, 19],     // extra units/s above top speed
    boostStageDuration: [0, 0.75, 1.15, 1.6], // seconds the bonus takes to decay to 0

    // ---------------------------------------------------------------- off-track
    offTrackMaxSpeed: 14,    // hard speed ceiling on the grass
    offTrackDrag: 4.5,       // strong decel toward the ceiling when off-track
    offTrackGrip: 5.5,       // grass is a little loose underfoot

    // ---------------------------------------------------------------- camera
    camDistance: 7.4,        // how far behind the kart the camera sits
    camHeight: 3.3,          // camera height above the ground
    camLookAhead: 7.0,       // look target distance ahead of the kart
    camLookHeight: 0.9,      // look slightly down toward the kart
    camFollowLag: 6.5,       // position follow rate (higher = tighter, less lag)
    camFovBase: 72,
    camFovBoost: 82,         // FOV widens on boost to sell speed
    camFovLag: 4.0,
    camBoostPullback: 1.6,   // extra distance the camera drops back at full boost

    // ---------------------------------------------------------------- visual feel
    kartBodyRoll: 0.45,      // radians the body leans into a drift at full slide
    kartBoostSquash: 0.12,   // body stretch on boost (0 = none)

    // ---------------------------------------------------------------- race
    totalLaps: 3,
    countdownSeconds: 3,
};

// Track geometry. Centerline control points (closed Catmull-Rom loop) and the
// half-width of the drivable ribbon. Two tight-ish corners and a couple of
// sweepers so drift pays off. Kept here (not in render) because the simulation
// needs the same geometry for the on-track test and lap progress.
export const TRACK = {
    halfWidth: 6.5,
    // [x, z] control points, traversed in order. Closed loop.
    controlPoints: [
        [0, -52],
        [42, -46],
        [58, -8],
        [30, 12],     // chicane-ish kink
        [48, 42],
        [8, 58],
        [-34, 48],
        [-54, 10],
        [-36, -22],   // hairpin-ish
        [-12, -42],
    ],
    samplesPerSegment: 26,   // spline resolution for the on-track test + mesh
};

export const COLORS = {
    sky: 0x9fd3ff,
    fog: 0xbfe0ff,
    grass: 0x3f7a4a,
    grassDark: 0x356b40,
    track: 0x3a3d46,
    trackEdge: 0xf4f4f8,
    centerLine: 0xf4d03f,
    startLine: 0xffffff,
    kartBody: 0xff5a4d,
    kartAccent: 0x1a1a22,
    wheel: 0x14141a,
    driftStage: [0x39d0ff, 0xff9f1c, 0xb06bff], // blue, orange, purple sparks/glow
};
