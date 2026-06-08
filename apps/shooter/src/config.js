// Central tuning + content definitions for Neon Siege.

export const COLORS = {
  bg:        0x06030f,
  fog:       0x0a0720,
  cyan:      0x35e6ff,
  magenta:   0xff3df0,
  amber:     0xffb023,
  lime:      0x7dff8a,
  red:       0xff3b5c,
  white:     0xffffff,
};

// Player / movement
export const PLAYER = {
  eye: 1.62,        // camera height above feet
  radius: 0.42,
  walk: 7.2,
  sprint: 11.2,
  crouchSpeed: 3.6,
  jump: 8.4,
  gravity: 24,
  stepUp: 0.62,     // max ledge you can walk straight up (stairs/ramps)
  stepDown: 0.6,    // max drop you stick to instead of falling
  maxHp: 100,
  maxArmor: 100,
  accel: 13,
};

// Skin tones for the (human) enemies
export const SKIN = [0xe8b48a, 0xc98a5e, 0xa86a44, 0x8a5235, 0xf0c9a0, 0xb98c6a];

// Enemy factions — all human/augmented. accent = glowing cybernetic color.
export const ENEMY_TYPES = {
  thug: {
    hp: 72, speed: 4.6, dmg: 9, reward: 50, score: 50,
    height: 1.0, build: 1.0, accent: COLORS.cyan, ranged: false,
    gait: 'walk', aggression: 1.0,
  },
  runner: {
    hp: 34, speed: 8.2, dmg: 6, reward: 45, score: 45,
    height: 0.96, build: 0.82, accent: COLORS.magenta, ranged: false,
    gait: 'run', aggression: 1.5, lunge: true,
  },
  brute: {
    hp: 340, speed: 3.0, dmg: 26, reward: 140, score: 130,
    height: 1.28, build: 1.5, accent: COLORS.amber, ranged: false,
    gait: 'heavy', aggression: 0.7,
  },
  gunner: {
    hp: 110, speed: 3.4, dmg: 13, reward: 95, score: 95,
    height: 1.02, build: 0.95, accent: COLORS.lime, ranged: true,
    gait: 'walk', keep: 17, aggression: 0.6,
  },
};

// Weapons. dmg is per-pellet; bloom grows per shot, recovers when idle.
export const WEAPONS = [
  { id:'pulse', name:'PULSE SIDEARM', color:COLORS.cyan, dmg:40, rof:0.14, mag:15, reserveMax:120,
    auto:false, pellets:1, spread:0.004, bloomShot:0.006, bloomMax:0.045, range:150, pierce:1,
    recoilV:0.024, recoilH:0.010, kick:0.06, reloadT:1.05, adsFov:52, shells:false,
    owned:true, ammo:15, reserve:90, dmgLvl:0, frame:'pistol' },
  { id:'smg', name:'ARC SMG', color:COLORS.lime, dmg:19, rof:0.062, mag:45, reserveMax:360,
    auto:true, pellets:1, spread:0.012, bloomShot:0.011, bloomMax:0.08, range:110, pierce:1,
    recoilV:0.017, recoilH:0.014, kick:0.034, reloadT:1.55, adsFov:56, shells:false,
    owned:false, price:1400, ammo:45, reserve:180, dmgLvl:0, frame:'smg' },
  { id:'shotgun', name:'PLASMA SCATTER', color:COLORS.magenta, dmg:15, rof:0.72, mag:7, reserveMax:64,
    auto:false, pellets:9, spread:0.072, bloomShot:0, bloomMax:0.072, range:46, pierce:1,
    recoilV:0.06, recoilH:0.02, kick:0.18, reloadT:1.8, adsFov:60, shells:true,
    owned:false, price:2600, ammo:7, reserve:35, dmgLvl:0, frame:'shotgun' },
  { id:'rail', name:'RAIL LANCE', color:COLORS.amber, dmg:285, rof:1.0, mag:5, reserveMax:45,
    auto:false, pellets:1, spread:0, bloomShot:0, bloomMax:0, range:240, pierce:6,
    recoilV:0.105, recoilH:0.012, kick:0.34, reloadT:1.85, adsFov:26, shells:false,
    owned:false, price:4200, ammo:5, reserve:25, dmgLvl:0, frame:'rail' },
];

export function waveConfig(n) {
  return {
    hpScale: 1 + (n - 1) * 0.16,
    speedScale: Math.min(1.7, 1 + (n - 1) * 0.028),
    spawnInterval: Math.max(0.2, 1.25 - n * 0.05),
    maxAlive: Math.min(26, 7 + Math.floor(n * 1.3)),
    count: Math.round(7 + n * 2.4 + n * n * 0.22),
    elite: n % 5 === 0,
  };
}

export function pickEnemyType(n) {
  const r = Math.random();
  const brute = Math.min(0.22, 0.02 + n * 0.015);
  const gunner = Math.min(0.28, n >= 3 ? 0.06 + n * 0.012 : 0);
  const runner = Math.min(0.42, 0.16 + n * 0.012);
  if (r < brute) return 'brute';
  if (r < brute + gunner) return 'gunner';
  if (r < brute + gunner + runner) return 'runner';
  return 'thug';
}
