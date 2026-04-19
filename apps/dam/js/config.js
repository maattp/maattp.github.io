// World grid (the stream flows from back, j=0, toward camera, j=GRID_H-1)
export const GRID_W = 34;
export const GRID_H = 34;

// Isometric tile dimensions in screen pixels at scale 1.
// Portrait orientation: diamonds are taller than wide so the grid
// projects into a shape that fills a phone screen top-to-bottom.
export const TILE_W = 12;
export const TILE_H = 24;
export const HEIGHT_SCALE = 11;

// Terrain shape
export const BEACH_SLOPE = 0.09;      // rise per cell going upstream
export const STREAM_DEPTH = 3.0;      // depth of the natural stream valley
export const STREAM_WIDTH = 2.6;      // half-width of the valley in cells
export const STREAM_MEANDER = 1.6;    // sine amplitude
export const STREAM_FREQ = 0.2;       // meander frequency
export const BANK_SLOPE = 1.1;        // rise per cell going laterally away from stream
export const BANK_MAX = 3.8;          // cap on bank rise so beach plateaus
export const SPRING_POOL_ROWS = 3;    // extra-deep rows near the top for the spring
export const SPRING_POOL_EXTRA = 1.2;
export const OCEAN_ROW = GRID_H - 3;  // where ocean waves start

// SPH
export const PARTICLE_MASS = 1.0;
export const H = 0.82;                // smoothing length (world units)
export const H2 = H * H;
export const REST_DENSITY = 3.0;
export const STIFFNESS = 70;
export const VISCOSITY = 3.4;
export const GRAVITY = 4.5;           // slope-driven force magnitude (gentle)
export const DOWNSTREAM_BIAS = 0.15;  // small constant nudge toward the ocean
export const TERRAIN_WALL_K = 900;    // spring constant for terrain walls
export const TERRAIN_DAMP = 10.0;
export const MAX_PARTICLES = 1400;
export const MAX_SPEED = 5.5;

// Spawning — keep it low so the stream is a trickle, not a flood.
// Particles drain at the ocean, so this is a steady-state throughput.
export const SPAWN_PER_SEC = 95;
export const SPAWN_JITTER = 0.2;

// Erosion thresholds (flow-force needed to dislodge 1 unit)
export const SAND_RESIST = 0.35;      // easily washed
export const STICK_RESIST = 2.2;      // medium
export const ROCK_RESIST = 6.5;       // hard to move
export const EROSION_RATE = 0.9;      // sand erosion scaling

// Material heights per unit stacked in a cell (world units).
// Bigger numbers mean each placement is a more impactful obstacle.
export const SAND_UNIT_H = 0.28;
export const STICK_UNIT_H = 0.55;
export const ROCK_UNIT_H = 1.05;

// Tool cooldowns (ms) and dispenses
export const ROCK_CD = 350;
export const STICK_CD = 220;
export const SAND_PLACE_AMOUNT = 1.7;
export const SAND_PLACE_RADIUS = 1.6;
export const DIG_AMOUNT = 1.6;

// Simulation
export const DT = 1 / 90;             // physics timestep
export const MAX_SUBSTEPS = 3;        // cap substeps per frame

// Camera
export const CAM_MARGIN = 16;
