// World grid (the stream flows from back, j=0, toward camera, j=GRID_H-1)
export const GRID_W = 26;
export const GRID_H = 40;

// Isometric tile dimensions in screen pixels at scale 1
export const TILE_W = 24;
export const TILE_H = 12;
export const HEIGHT_SCALE = 10;

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
export const H = 0.78;                // smoothing length (world units)
export const H2 = H * H;
export const REST_DENSITY = 3.2;
export const STIFFNESS = 55;
export const VISCOSITY = 2.8;
export const GRAVITY = 9.0;           // slope-driven force magnitude
export const TERRAIN_WALL_K = 240;    // spring constant for terrain walls
export const TERRAIN_DAMP = 4.0;
export const MAX_PARTICLES = 1600;
export const MAX_SPEED = 10.0;

// Spawning
export const SPAWN_PER_SEC = 240;     // total per second from the spring
export const SPAWN_JITTER = 0.35;

// Erosion thresholds (flow-force needed to dislodge 1 unit)
export const SAND_RESIST = 0.55;      // easily washed
export const STICK_RESIST = 2.8;      // medium
export const ROCK_RESIST = 7.5;       // hard to move
export const EROSION_RATE = 1.3;      // sand erosion scaling

// Material heights per unit stacked in a cell (world units)
export const SAND_UNIT_H = 0.18;
export const STICK_UNIT_H = 0.30;
export const ROCK_UNIT_H = 0.45;

// Tool cooldowns (ms) and dispenses
export const ROCK_CD = 850;
export const STICK_CD = 450;
export const SAND_PLACE_AMOUNT = 0.9;
export const DIG_AMOUNT = 0.9;

// Simulation
export const DT = 1 / 90;             // physics timestep
export const MAX_SUBSTEPS = 3;        // cap substeps per frame

// Camera
export const CAM_MARGIN = 28;
