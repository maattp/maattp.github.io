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
    driftMinSpeed: 11,        // must be going at least this fast to start a drift
    driftSteerThreshold: 0.16,// must be turning at least this hard to start a drift
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
    kartBodyRoll: 0.42,      // radians the body leans into a drift at full slide
    kartBoostSquash: 0.12,   // body stretch on boost (0 = none)
    kartDriftHop: 0.35,      // little hop height when a drift kicks off
    wheelSteerMaxDeg: 26,    // visual front-wheel turn at full steer
    camShakeBoost: 0.22,     // camera shake amplitude at full boost
    camShakeStageUp: 0.5,    // shake kick when a drift charge stage levels up

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
    // [x, z] control points, traversed in order. Closed loop. This curve was
    // validated offline to be free of self-overlap (min self-distance ~52u) while
    // featuring one tight corner (turn radius ~12u), several medium corners, and
    // long sweepers — so drift pays off differently around the lap. Start/finish
    // sits on the straightest section.
    controlPoints: [
        [-29.1, 36.5], [-47.5, 22.9], [-63.1, 0], [-60, -28.9],
        [-35.7, -44.8], [-8.8, -38.4], [5.5, -24.3], [15.4, -19.4],
        [36.6, -17.6], [63.1, 0], [71, 34.2], [49.4, 61.9],
        [14.8, 65], [-11.6, 50.9],
    ],
    samplesPerSegment: 26,   // spline resolution for the on-track test + mesh
};

export const COLORS = {
    skyTop: 0x3f9bff,        // zenith
    skyBottom: 0xcdecff,     // horizon
    fog: 0xd2ecff,
    sun: 0xfff4dc,
    grass: 0x67c24f,         // bright cartoon lawn
    grassDark: 0x57b341,     // mown stripe
    track: 0x565b6b,         // asphalt
    trackEdge: 0xf4f4f8,
    kerbRed: 0xe8473f,
    kerbWhite: 0xf6f6f6,
    centerLine: 0xf4d23f,
    startLine: 0xffffff,
    bannerPost: 0xf24e4e,
    bannerCloth: 0x2a2f3a,
    kartBody: 0xff5a4d,
    kartBody2: 0xffd23f,     // accent stripe / spoiler
    kartAccent: 0x23252e,
    driver: 0xffd9b3,        // skin
    helmet: 0x2f7bdc,
    wheel: 0x1b1b22,
    hubcap: 0xe6e6ec,
    cone: 0xff7a1e,
    treeTrunk: 0x8a5a2b,
    treeLeaf: 0x47b04a,
    treeLeaf2: 0x5fc95f,
    cloud: 0xffffff,
    hill: 0x7fd06a,
    driftStage: [0x39d0ff, 0xff9f1c, 0xb06bff], // blue, orange, purple sparks/glow
};

// Counts / sizes for set dressing and effects. Bumped down on mobile by the tier.
export const VISUALS = {
    trees: 46,
    clouds: 14,
    hills: 9,
    conesPerSide: 26,        // pylons spaced along each track edge
    smokeMax: 90,            // drift smoke particle pool
    skidMax: 140,            // skid-mark quad pool
    sparkMax: 60,            // boost / stage-up spark pool
};
