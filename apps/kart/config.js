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
    topSpeed: 42,            // normal forward top speed (units/s)
    accel: 2.4,              // ramp-up rate toward target while accelerating
    engineBrake: 1.7,        // ramp-down rate when above target (how boost bleeds off)
    brakeStrength: 5.0,      // ramp rate toward 0 / reverse while braking (firm)
    coastDrag: 0.7,          // ramp toward 0 when neither accelerating nor braking
    reverseSpeed: 12,        // top reverse speed when holding brake from a stop

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
    // carve a wide arc. The effective grip eases toward its target (gripEase) so
    // engaging/releasing a drift doesn't snap the kart sideways.
    normalGrip: 9.0,
    driftGrip: 5.2,          // higher = a gentle, controllable slide (less throw-off)
    gripEase: 7.0,           // how fast grip transitions (lower = smoother onset)

    // ---------------------------------------------------------------- drift
    driftMinSpeed: 11,        // must be going at least this fast to start a drift
    driftSteerThreshold: 0.16,// must be turning at least this hard to start a drift
    // Drift yaw is ADDITIVE so you stay in control: a gentle base pull in the
    // drift direction, plus your raw steering on top. Steering into the drift
    // tightens it; countersteering subtracts and can hold a line or straighten you
    // right out of the drift. The total is kept at/below a normal hard turn, so a
    // drift never snaps the kart around — it's a controllable slide, not a spin.
    driftBaseYaw: 0.30,        // base turn in the drift direction (gentle)
    driftSteerAuthority: 0.60, // how much raw steer (-1..1) adds/subtracts on top
    // Seconds of continuous drift needed to reach each charge stage.
    // [stage1 (blue), stage2 (orange), stage3 (purple)]
    driftStageTimes: [0.55, 1.30, 2.20],

    // ---------------------------------------------------------------- boost
    // Indexed by the highest stage reached when drift is released (0 = released
    // before stage 1 -> nothing). Boost adds a decaying bonus on top of topSpeed.
    boostStageBonus: [0, 10, 16, 24],    // extra units/s above top speed
    boostStageDuration: [0, 0.75, 1.15, 1.6], // seconds the bonus takes to decay to 0

    // ---------------------------------------------------------------- off-track
    offTrackMaxSpeed: 16,    // hard speed ceiling on the grass runoff
    offTrackDrag: 4.5,       // strong decel toward the ceiling when off-track
    offTrackGrip: 5.5,       // grass is a little loose underfoot

    // ---------------------------------------------------------------- walls
    kartRadius: 1.1,         // collision radius so the body edge stops AT the wall, not in it
    wallBounce: 0.0,         // 0 = pure slide along wall (smooth), higher = bounce off it
    wallScrub: 0.96,         // speed retained on wall contact (lower = more punishing)

    // ---------------------------------------------------------------- terrain / vertical (2.5D)
    gravity: 30,             // downward acceleration (units/s^2)
    slopeAccel: 24,          // how strongly up/down slopes bleed/add forward speed
    airSteer: 0.35,          // fraction of normal steering authority while airborne
    hardLandSpeed: 14,       // downward speed above which a landing scrubs speed
    landScrub: 0.8,          // forward speed retained on the hardest landing

    // ---------------------------------------------------------------- camera
    camDistance: 8.6,        // how far behind the kart the camera sits
    camHeight: 4.0,          // camera height above the ground
    camLookAhead: 9.0,       // look target distance ahead of the kart
    camLookHeight: 1.0,      // look slightly down toward the kart
    camFollowLag: 6.5,       // position follow rate (higher = tighter, less lag)
    camFovBase: 72,
    camFovBoost: 82,         // FOV widens on boost to sell speed
    camFovLag: 4.0,
    camBoostPullback: 1.6,   // extra distance the camera drops back at full boost

    // ---------------------------------------------------------------- visual feel
    kartBodyRoll: 0.28,      // radians the body leans into a drift at full slide
    kartBoostSquash: 0.12,   // body stretch on boost (0 = none)
    kartDriftHop: 0.12,      // small hop when a drift kicks off (subtle)
    wheelSteerMaxDeg: 26,    // visual front-wheel turn at full steer
    camShakeBoost: 0.14,     // camera shake amplitude at full boost
    camShakeStageUp: 0.26,   // shake kick when a drift charge stage levels up

    // ---------------------------------------------------------------- race
    totalLaps: 3,
    countdownSeconds: 3,
};

// Track geometry. Centerline control points (closed Catmull-Rom loop) and the
// half-width of the drivable ribbon. Two tight-ish corners and a couple of
// sweepers so drift pays off. Kept here (not in render) because the simulation
// needs the same geometry for the on-track test and lap progress.
export const TRACK = {
    halfWidth: 12,           // drivable road half-width (24u wide -> ~4 karts abreast)
    wallHalfWidth: 14.5,     // hard wall: ~2.5u of grass runoff outside the road, then a barrier
    // [x, z] control points, traversed in order. Closed loop. Validated offline to
    // be free of self-overlap (min self-distance ~137u) with the tightest corner
    // (turn radius ~32u) well clear of the wall radius. ~985u long — a big, flowing
    // circuit. It drapes over the terrain heightfield (see TERRAIN), so corners and
    // straights gain real elevation. Start/finish on the straightest part.
    controlPoints: [
        [-70.1, 87.9], [-118.2, 57], [-162.4, 0], [-157.8, -76.1],
        [-95.3, -119.4], [-23.5, -103.5], [15, -65.6], [40.8, -51.2],
        [94.8, -45.6], [162.4, 0], [181.4, 87.3], [124.5, 156.1],
        [36.6, 160.5], [-28, 122.7],
    ],
    samplesPerSegment: 26,   // spline resolution for the on-track test + mesh
};

// Terrain heightfield (y = height(x,z)). Low-frequency waves give rolling hills;
// Gaussian bumps add local hills / ramps. Validated so slopes along the track stay
// drivable (max along-track ~13deg) while giving ~19u of elevation across the lap.
// Single-valued by design (no bridges/overlaps — that's Level 3, out of scope).
export const TERRAIN = {
    waves: [
        { a: 7,   fx: 0.013, fz: 0.015, px: 0.5, pz: 1.2 },
        { a: 4,   fx: 0.024, fz: 0.020, px: 2.1, pz: 0.3 },
        { a: 2,   fx: 0.041, fz: 0.038, px: 0.0, pz: 2.0 },
    ],
    bumps: [
        { x: 90,   z: -70,  a: 8, s: 24 },   // hill beside a corner
        { x: -150, z: 120,  a: 6, s: 30 },   // off-track rise
    ],
};

export const COLORS = {
    skyTop: 0x3f9bff,        // zenith
    skyBottom: 0xcdecff,     // horizon
    fog: 0xd2ecff,
    sun: 0xfff4dc,
    grass: 0x67c24f,         // bright cartoon lawn (track verge)
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
    cloud: 0xffffff,
    driftStage: [0x39d0ff, 0xff9f1c, 0xb06bff], // blue, orange, purple sparks/glow
};

// Counts / sizes for set dressing and effects.
export const VISUALS = {
    clouds: 16,
    conesPerSide: 32,        // pylons spaced along each track edge
    smokeMax: 90,            // drift smoke particle pool
    skidMax: 160,            // skid-mark quad pool
    sparkMax: 60,            // boost / stage-up spark pool
};
