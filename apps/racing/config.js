// Shared tunable constants for the tunnel racer.
//
// Coordinate convention: the tube axis is Z. "Forward" (the direction the
// craft travels) is -Z, into the screen. The player craft and camera stay
// fixed near z=0; the world (tunnel + obstacles) streams toward +Z, past the
// camera, and recycles. Steering is a rotation of the world group about Z, so
// the craft always sits at the bottom of the tube on screen while the tunnel
// spins around it.

export const TUBE_RADIUS = 7.4;          // inner radius of the tunnel wall
export const CRAFT_RADIUS = TUBE_RADIUS - 1.05;  // craft hovers just inside the wall
export const ENTITY_RADIUS = TUBE_RADIUS - 0.55; // obstacles/pickups sit on the wall

export const TUNNEL_LENGTH = 1100;       // total length of the tube mesh (Z span)
export const SPAWN_Z = -480;             // where things appear out of the fog
export const RECYCLE_Z = 16;             // behind the camera -> wrap forward
export const PLAYER_Z = 0;               // craft plane; collisions resolve here

// Chase camera placement (relative to craft at (0, -CRAFT_RADIUS, 0)).
export const CAM_BACK = 7.2;             // behind the craft (+Z)
export const CAM_RISE = 2.6;             // toward tube center from the craft (+Y)
export const CAM_LOOK_AHEAD = 22;        // look target distance ahead (-Z)
export const CAM_LOOK_RISE = 1.1;        // look slightly up from the craft
export const FOV_BASE = 78;
export const FOV_BOOST = 100;            // FOV punch at peak boost

// Speeds are in world units / second.
export const SPEED_START = 78;
export const SPEED_MAX = 188;            // base cruising speed cap (grows with distance)
export const SPEED_RAMP_DIST = 9000;     // distance over which base speed climbs to max
export const BOOST_SPEED = 320;          // peak speed right after hitting a ramp
export const BOOST_DECAY = 0.62;         // higher = boost fades faster
export const HIT_SLOWDOWN = 0.55;        // speed multiplier applied on a crash

// Collision tolerances (radians). HIT_MARGIN widens an obstacle's hit arc by
// roughly the craft's half-width; COLLECT/RAMP are how close you must line up.
export const HIT_MARGIN = 0.05;
export const COLLECT_ANGLE = 0.40;
export const RAMP_ANGLE = 0.34;

// Steering feel.
export const MAX_ANG_VEL = 3.7;          // rad/sec at full tilt
export const STEER_SMOOTH = 7.5;         // how fast steering eases toward input
export const TILT_RANGE_DEG = 32;        // tilt (deg) that maps to full steer

// Gameplay.
export const START_SHIELDS = 3;
export const MAX_SHIELDS = 5;
export const INVULN_TIME = 1.4;          // seconds of i-frames after a crash

// Palette (Wipeout / F-Zero: deep space, neon track, hot accents).
export const COL_TUNNEL_A = 0x12c2e9;    // cyan grid
export const COL_TUNNEL_B = 0xc471ed;    // magenta grid
export const COL_OBSTACLE = 0xff2d55;    // hot red barriers
export const COL_COLLECT = 0xffd24a;     // gold pickups
export const COL_RAMP = 0x39ff9e;        // green boost pads
export const COL_FOG = 0x05030f;         // near-black violet
export const COL_CRAFT = 0xdfe9ff;
export const COL_CRAFT_GLOW = 0x39d0ff;
