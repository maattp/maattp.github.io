// EMERALD CITY: a pinball table, its physics and its rules. No DOM, no THREE:
// pinball.js draws it and feeds it the buttons, and Node can play it.
//
// Table units, y DOWN the playfield (toward the flippers), 20 units to the
// inch: 400 x 800 is a 20 x 40 in playfield with a 1 1/16 in ball (R 10.5).
// Gravity along the glass is g sin(6.5 deg) nudged up for pace. The ball runs
// at 12 substeps a 60 Hz frame (under 6 units a substep at the speed cap, half
// a radius), so nothing tunnels. Walls are thin segments tested by distance,
// posts and bumpers circles, and each flipper a tapered capsule turning about
// its pivot: its surface velocity (omega x r) goes into the bounce, which is
// what makes the shot depend on where the ball is on the flipper and when you
// hit it, and why a raised flipper cradles.
//
// Layout (see the header of pinball.js for the art): three pop bumpers under
// three top lanes (S E A, lane change on the flippers, bonus X on a set), a
// left orbit with a spinner, a three-bank of drop targets on the orbit's
// wall, a kickout saucer in the middle (LOCK when the bank is down; two locks
// is three-ball multiball with a JACKPOT on the ramp), the NEEDLE ramp on the
// right feeding the left inlane, slingshots, inlanes and outlanes with a
// kickback on the left, the shooter lane and a one-way gate at its top.

export const W = 400, H = 800, R = 10.5;
const G = 1150;                      // along the glass, u/s^2
export const SUB = 12;
const VMAX = 4000;
const WALL_E = 0.45, POST_E = 0.7, FLIP_E = 0.55;

// --- geometry -------------------------------------------------------------------------

// the top: a flat head with rounded corners. A ball round the right corner leaves it
// and falls in an arc, so how hard you plunge picks the lane it drops into.
export const TOP_Y = 15, CORNER_R = 90;
export const TOP_PTS = (() => {
  const p = [[15, 800], [15, TOP_Y + CORNER_R]];
  for (let i = 1; i <= 12; i++) { const a = Math.PI + Math.PI / 2 * i / 12; p.push([15 + CORNER_R + CORNER_R * Math.cos(a), TOP_Y + CORNER_R + CORNER_R * Math.sin(a)]); }
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + Math.PI / 2 * i / 12; p.push([389 - CORNER_R + CORNER_R * Math.cos(a), TOP_Y + CORNER_R + CORNER_R * Math.sin(a)]); }
  p.push([389, 800]);
  return p;
})();
export const FLIP_LEN = 60, FLIP_R0 = 11, FLIP_R1 = 6;
export const BUMPERS = [{ x: 165, y: 205, r: 21 }, { x: 235, y: 200, r: 21 }, { x: 200, y: 262, r: 21 }];
export const LANES = [{ x: 170, lbl: 'S' }, { x: 210, lbl: 'E' }, { x: 250, lbl: 'A' }];
export const LANE_GUIDES = [150, 190, 230, 270];
export const LANE_Y0 = 62, LANE_Y1 = 118, LANE_SENSE = 96;
export const SAUCER = { x: 196, y: 352, r: 11 };
export const DROPS = [{ y0: 290, y1: 312 }, { y0: 318, y1: 340 }, { y0: 346, y1: 368 }];
export const DROP_X = 64;
export const ORBIT_X = 58, ORBIT_Y0 = 250, ORBIT_Y1 = 470, SPINNER_Y = 400;
export const RAMP_X0 = 300, RAMP_X1 = 357, RAMP_CAP_Y = 352, RAMP_GUIDE_Y1 = 450;
export const SHOOTER = { x0: 357, x1: 389, x: 373, plunger: 772 };
export const SLINGS = [
  { pts: [[80, 585], [80, 640], [104, 657]], kick: [[80, 585], [104, 657]] },
  { pts: [[292, 585], [292, 640], [268, 657]], kick: [[292, 585], [268, 657]] },
];
export const FLIPPERS = [
  { x: 112, y: 704, rest: 0.5, up: -0.4 },
  { x: 260, y: 704, rest: Math.PI - 0.5, up: Math.PI + 0.4 },
];
export const GUIDES = [
  [[15, 480], [38, 528]],          // the orbit's exit deflector: down the left side you land in the inlane
  [[45, 560], [45, 655], [104, 691]],
  [[45, 655], [45, 800]],
  [[327, 560], [327, 655], [268, 691]],
  [[327, 655], [327, 800]],
];

/** The ramp's path in the air: from its lip up the right, over the top and down to the left inlane. */
export const RAMP_PATH = (() => {
  const p = [[328, 352], [328, 240], [328, 150]];
  // over the top lanes: centre (202, 150), radius 126, from the right (0) to the left (pi), over the top
  for (let i = 1; i <= 20; i++) { const a = -Math.PI * i / 20; p.push([202 + 126 * Math.cos(a), 150 + 126 * Math.sin(a)]); }
  // and down over the orbit lane to the left inlane
  p.push([64, 205], [44, 262], [36, 330], [36, 430], [42, 492], [56, 540], [62, 572]);
  const s = [0];
  for (let i = 1; i < p.length; i++) s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return { p, s, len: s[s.length - 1], topS: s[2] };
})();

function rampAt(s) {
  const { p, s: cs } = RAMP_PATH;
  let i = 1;
  while (i < cs.length - 1 && cs[i] < s) i++;
  const t = Math.max(0, Math.min(1, (s - cs[i - 1]) / (cs[i] - cs[i - 1])));
  const dx = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1], L = Math.hypot(dx, dy) || 1;
  return { x: p[i - 1][0] + dx * t, y: p[i - 1][1] + dy * t, dx: dx / L, dy: dy / L };
}

function buildWalls() {
  const segs = [];
  const wall = (pts, e = WALL_E, extra = {}) => { for (let i = 1; i < pts.length; i++) segs.push({ ax: pts[i - 1][0], ay: pts[i - 1][1], bx: pts[i][0], by: pts[i][1], e, w: 1.5, ...extra }); };
  wall(TOP_PTS);
  wall([[357, 240], [357, 800]]);
  // the one-way gate at the shooter lane's top, sloped to roll a ball back into play
  segs.push({ ax: 389, ay: 215, bx: 357, by: 240, e: 0.3, w: 1.5, oneway: norm(-25, -32), kind: 'gate' });
  // the top lanes
  for (const x of LANE_GUIDES) wall([[x, LANE_Y0], [x, LANE_Y1]], POST_E, { w: 3 });
  // the orbit's inner wall
  wall([[ORBIT_X, ORBIT_Y1], [ORBIT_X, ORBIT_Y0]], WALL_E, { w: 2.5 });
  // the ramp entrance: guide on its left, and the lip it bounces off when the shot is weak
  wall([[RAMP_X0, RAMP_GUIDE_Y1], [RAMP_X0, 332]], WALL_E, { w: 2.5 });
  wall([[RAMP_X0, 332], [RAMP_X1, 302]], 0.35, { w: 2, kind: 'lip' });
  for (const g of GUIDES) wall(g, WALL_E, { w: 2 });
  // slingshots: two passive edges and a kicker
  SLINGS.forEach((s, i) => {
    const [a, b, c] = s.pts;
    wall([a, b, c], POST_E, { w: 2.5 });
    const n = outward(s.kick[0], s.kick[1], centroid(s.pts));
    segs.push({ ax: s.kick[0][0], ay: s.kick[0][1], bx: s.kick[1][0], by: s.kick[1][1], e: POST_E, w: 2.5, kind: 'sling', id: i, kickN: n });
  });
  // plunger floor
  segs.push({ ax: SHOOTER.x0, ay: SHOOTER.plunger, bx: SHOOTER.x1, by: SHOOTER.plunger, e: 0.15, w: 1, kind: 'plunger' });
  // drop targets
  DROPS.forEach((d, i) => segs.push({ ax: DROP_X, ay: d.y0, bx: DROP_X, by: d.y1, e: 0.3, w: 2.5, kind: 'drop', id: i }));
  return segs;
}
function norm(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
function outward(a, b, c) {
  let n = norm(-(b[1] - a[1]), b[0] - a[0]);
  if ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] > 0) n = [-n[0], -n[1]];
  return n;
}
export const WALLS = buildWalls();

// --- scoring ----------------------------------------------------------------------------

const PTS = { bumper: 3000, sling: 510, lane: 10000, laneSet: 25000, spinner: 1500, drop: 5000, bank: 50000, ramp: 50000,
  saucer: 25000, lock: 100000, jackpot: 1000000, skill: 250000, inlane: 5000, outlane: 20000, orbit: 30000 };
const BALLS = 3;
const SAVE_T = 10;
const RAMPS_FOR_EB = 6;       // the first extra ball; each after is ten more

export class Table {
  /** opts: { rng } */
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.flips = FLIPPERS.map((f, i) => ({ ...f, a: f.rest, w: 0, on: false, side: i }));
    this.drops = DROPS.map(() => false);
    this.bumpFlash = BUMPERS.map(() => 0);
    this.slingFlash = [0, 0];
    this.lanes = [false, false, false];
    this.laneFlash = 0;
    this.spin = { a: 0, w: 0, acc: 0 };
    this.balls = [];
    this.score = 0;
    this.ball = 1;
    this.extra = 0;
    this.bonus = 0;
    this.bonusX = 1;
    this.locked = 0;
    this.lockLit = false;
    this.multiball = false;
    this.jackpot = false;
    this.rampCount = 0;
    this.rampCombo = 0;
    this.ebLit = false;
    this.ebAt = RAMPS_FOR_EB;
    this.kickback = true;
    this.spinCount = 0;
    this.save = 0;
    this.tilt = 0;
    this.tilted = false;
    this.warned = 0;
    this.skillLane = 0;
    this.skillT = 0;
    this.skillLive = false;
    this.plunge = 0;              // 0..1, the pull
    this.pulling = false;
    this.pending = [];            // balls to auto-launch
    this.state = 'plunge';        // plunge | play | bonus | over
    this.bonusT = 0;
    this.msgs = [];               // { a, b, t }  (DMD lines)
    this.events = [];             // sounds for the shell
    this.t = 0;
    this.over = false;
    this._serve(false);
  }

  // --- the shell's calls -----------------------------------------------------------------

  /** input: { left, right, plunge, nudge } (held states; nudge an edge). */
  step(dt, input) {
    this.t += dt;
    this.tick(dt);
    const plungeHeld = !!input.plunge;
    this._flippers(input);
    // the plunger
    const waiting = this._waiting();
    if (waiting && plungeHeld) { this.pulling = true; this.plunge = Math.min(1, this.plunge + dt / 0.8); }
    else if (this.pulling) {
      this.pulling = false;
      if (waiting) this._launch(waiting, this.plunge);
      this.plunge = 0;
    }
    if (input.nudge) this._nudge();
    this.tilt = Math.max(0, this.tilt - dt * 0.45);
    // auto-launch queue (ball save, multiball)
    if (this.pending.length && !this._inLane()) {
      this.pending[0] -= dt;
      if (this.pending[0] <= 0) { this.pending.shift(); const b = this._newBall(); this._launch(b, 0.62 + this.rng() * 0.06, true); }
    }
    // skill shot lane cycles while the ball waits
    if (this.state === 'plunge') { this.skillT += dt; if (this.skillT > 0.45) { this.skillT = 0; this.skillLane = (this.skillLane + 1) % 3; } }
    if (this.save > 0 && this.state === 'play') this.save -= dt;
    // physics
    const h = dt / SUB;
    for (let k = 0; k < SUB; k++) {
      for (const f of this.flips) this._moveFlipper(f, h);
      for (const b of this.balls) this._ballStep(b, h);
    }
    // per frame: held balls, drains, stuck balls
    for (const b of this.balls) this._ballFrame(b, dt);
    this._drains();
    // lights
    for (let i = 0; i < 3; i++) this.bumpFlash[i] = Math.max(0, this.bumpFlash[i] - dt);
    for (let i = 0; i < 2; i++) this.slingFlash[i] = Math.max(0, this.slingFlash[i] - dt);
    this.laneFlash = Math.max(0, this.laneFlash - dt);
    this.spin.w *= Math.exp(-dt * 1.6);
    this.spin.a += this.spin.w * dt;
    this.spin.acc += Math.abs(this.spin.w) * dt;
    while (this.spin.acc >= 1) { this.spin.acc -= 1; this._spinTick(); }
    for (const m of this.msgs) m.t -= dt;
    this.msgs = this.msgs.filter((m) => m.t > 0);
    if (this.state === 'bonus') this._bonusStep(dt);
  }

  takeEvents() { const e = this.events; this.events = []; return e; }

  /** The camera wants the most urgent ball: the one lowest on the table. */
  focusY() {
    let y = -1;
    for (const b of this.balls) if (!b.locked) y = Math.max(y, b.ramp ? rampAt(b.ramp.s).y : b.y);
    return y < 0 ? H : y;
  }

  // --- balls -------------------------------------------------------------------------------

  _newBall() {
    const b = { x: SHOOTER.x, y: SHOOTER.plunger - R - 1.5, vx: 0, vy: 0, held: 0, ramp: null, still: 0, id: Math.floor(this.rng() * 1e9), lastLane: -1, px: SHOOTER.x, py: 0 };
    b.py = b.y;
    this.balls.push(b);
    return b;
  }

  _serve(shootAgain) {
    this.state = 'plunge';
    this.tilted = false;
    this.tilt = 0;
    this.warned = 0;
    this.skillLive = true;
    this._newBall();
    this.drops = DROPS.map(() => false);
    if (!shootAgain) this.bonus = 0;
    this.bonusX = shootAgain ? this.bonusX : 1;
    this._msg(shootAgain ? 'SHOOT AGAIN' : `BALL ${this.ball}`, 'PULL AND RELEASE', 2.5);
  }

  _waiting() {
    if (this.state === 'bonus' || this.state === 'over') return null;
    for (const b of this.balls) if (!b.ramp && !b.held && b.x > SHOOTER.x0 && b.y > SHOOTER.plunger - 40 && Math.abs(b.vy) < 60) return b;
    return null;
  }
  _inLane() { for (const b of this.balls) if (b.x > SHOOTER.x0 && b.y > 300) return true; return false; }

  _launch(b, pull, auto) {
    b.vy = -(1150 + 950 * pull);
    b.vx = 0;
    b.launched = true;
    if (this.state === 'plunge') { this.state = 'play'; this.save = SAVE_T; }
    this.events.push(auto ? 'autoplunge' : 'plunge');
  }

  _ballStep(b, h) {
    if (b.locked || b.held > 0) return;
    if (b.ramp) { this._rampStep(b, h); return; }
    b.px = b.x; b.py = b.y;
    b.vy += G * h;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > VMAX) { b.vx *= VMAX / sp; b.vy *= VMAX / sp; }
    b.x += b.vx * h; b.y += b.vy * h;
    for (const s of WALLS) {
      if (s.kind === 'drop' && this.drops[s.id]) continue;
      this._seg(b, s);
    }
    for (let i = 0; i < BUMPERS.length; i++) this._bumper(b, BUMPERS[i], i);
    for (const f of this.flips) this._flipper(b, f);
    // other balls
    for (const o of this.balls) {
      if (o === b || o.locked || o.held > 0 || o.ramp || o.id < b.id) continue;
      const dx = o.x - b.x, dy = o.y - b.y, d = Math.hypot(dx, dy);
      if (d < 2 * R && d > 1e-6) {
        const nx = dx / d, ny = dy / d, pen = 2 * R - d;
        b.x -= nx * pen / 2; b.y -= ny * pen / 2; o.x += nx * pen / 2; o.y += ny * pen / 2;
        const rv = (o.vx - b.vx) * nx + (o.vy - b.vy) * ny;
        if (rv < 0) { const j = -(1 + 0.9) * rv / 2; b.vx -= j * nx; b.vy -= j * ny; o.vx += j * nx; o.vy += j * ny; if (rv < -200) this.events.push('clack'); }
      }
    }
    this._sensors(b);
    // a slight roll resistance
    const k = 1 - 0.06 * h;
    b.vx *= k; b.vy *= k;
  }

  _seg(b, s) {
    const ex = s.bx - s.ax, ey = s.by - s.ay, L2 = ex * ex + ey * ey;
    let t = ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = s.ax + ex * t, qy = s.ay + ey * t;
    const dx = b.x - qx, dy = b.y - qy, rr = R + s.w;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return 0;
    if (s.oneway && ((b.x - s.ax) * s.oneway[0] + (b.y - s.ay) * s.oneway[1] < 0 || b.vx * s.oneway[0] + b.vy * s.oneway[1] > 0)) return 0;
    const d = Math.sqrt(d2) || 1e-6;
    let nx = dx / d, ny = dy / d;
    if (s.oneway && nx * s.oneway[0] + ny * s.oneway[1] < 0) { nx = s.oneway[0]; ny = s.oneway[1]; }
    b.x = qx + nx * rr; b.y = qy + ny * rr;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + s.e) * vn * nx; b.vy -= (1 + s.e) * vn * ny;
      // a little friction along the wall
      const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty;
      b.vx -= vt * 0.015 * tx; b.vy -= vt * 0.015 * ty;
      this._hit(b, s, -vn, nx, ny);
    }
    return vn;
  }

  _hit(b, s, speed, nx, ny) {
    if (s.kind === 'sling') {
      if (speed > 40 && this.slingFlash[s.id] <= 0.08 && !this.tilted) {
        b.vx += s.kickN[0] * 820; b.vy += s.kickN[1] * 820;
        this.slingFlash[s.id] = 0.16;
        this._score(PTS.sling, 1);
        this.events.push('sling');
      }
    } else if (s.kind === 'drop') {
      if (speed > 110 && !this.drops[s.id]) {
        this.drops[s.id] = true;
        this._score(PTS.drop, 2);
        this.events.push('drop');
        if (this.drops.every(Boolean)) {
          this._score(PTS.bank, 3);
          if (!this.lockLit && !this.multiball) { this.lockLit = true; this._msg('LOCK IS LIT', 'SHOOT THE SAUCER', 2.2); this.events.push('lit'); }
          else this._msg('DROP BANK', '50,000', 1.4);
          this._later(1.2, () => { this.drops = DROPS.map(() => false); this.events.push('reset'); });
        }
      } else if (speed > 60) this.events.push('thud');
    } else if (s.kind === 'lip') {
      if (speed > 100) this.events.push('thud');
    } else if (speed > 380) this.events.push(s.e > 0.6 ? 'rubber' : 'thud');
  }

  _bumper(b, m, i) {
    const dx = b.x - m.x, dy = b.y - m.y, rr = R + m.r, d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
    b.x = m.x + nx * rr; b.y = m.y + ny * rr;
    let vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= 1.4 * vn * nx; b.vy -= 1.4 * vn * ny; vn = -0.4 * vn; }
    if (this.bumpFlash[i] <= 0.06 && !this.tilted) {
      const want = 1050 + this.rng() * 150;
      if (vn < want) { b.vx += (want - vn) * nx; b.vy += (want - vn) * ny; }
      this.bumpFlash[i] = 0.14;
      this._score(PTS.bumper, 1);
      this.events.push('bumper');
    }
  }

  _flipper(b, f) {
    const ex = Math.cos(f.a) * FLIP_LEN, ey = Math.sin(f.a) * FLIP_LEN;
    let t = ((b.x - f.x) * ex + (b.y - f.y) * ey) / (FLIP_LEN * FLIP_LEN);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = f.x + ex * t, qy = f.y + ey * t;
    const rr = R + FLIP_R0 + (FLIP_R1 - FLIP_R0) * t;
    const dx = b.x - qx, dy = b.y - qy, d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
    b.x = qx + nx * rr; b.y = qy + ny * rr;
    // the surface moves: omega x r at the contact
    const cx = b.x - nx * R - f.x, cy = b.y - ny * R - f.y;
    const sx = -f.w * cy, sy = f.w * cx;
    const rvx = b.vx - sx, rvy = b.vy - sy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const e = Math.abs(f.w) > 1 ? FLIP_E : 0.25;    // a still flipper deadens the ball
      b.vx = rvx - (1 + e) * vn * nx + sx;
      b.vy = rvy - (1 + e) * vn * ny + sy;
      if (-vn > 250) this.events.push(Math.abs(f.w) > 1 ? 'flipHit' : 'thud');
    }
    b.onFlip = f.side + 1;
  }

  _flippers(input) {
    const live = !this.tilted && this.state !== 'over';
    const want = [live && !!input.left, live && !!input.right];
    for (let i = 0; i < 2; i++) {
      const f = this.flips[i];
      if (want[i] && !f.on) {
        this.events.push('flip');
        // lane change: the lit lanes shift with the flipper
        if (this.state === 'play' || this.state === 'plunge') this._laneChange(i === 0 ? -1 : 1);
      } else if (!want[i] && f.on) this.events.push('flipDown');
      f.on = want[i];
    }
  }

  _moveFlipper(f, h) {
    const target = f.on ? f.up : f.rest;
    const speed = f.on ? 30 : 17;
    const d = target - f.a;
    const step = Math.sign(d) * Math.min(Math.abs(d), speed * h);
    f.w = step / h;
    f.a += step;
  }

  _laneChange(dir) {
    if (this.state === 'plunge') return;
    const l = this.lanes;
    this.lanes = dir < 0 ? [l[1], l[2], l[0]] : [l[2], l[0], l[1]];
  }

  _rampStep(b, h) {
    const r = b.ramp;
    // up the first leg it loses pace; over the top and down it gains a little
    if (r.s < RAMP_PATH.topS) r.v = Math.max(420, r.v - 1300 * h);
    else r.v = Math.min(1400, Math.max(r.v - 250 * h, 520));
    r.s += r.v * h;
    const q = rampAt(Math.min(r.s, RAMP_PATH.len));
    b.x = q.x; b.y = q.y;
    if (r.s >= RAMP_PATH.len) {
      b.ramp = null;
      b.vx = q.dx * Math.min(r.v, 700); b.vy = q.dy * Math.min(r.v, 700);
      b.px = b.x; b.py = b.y;
      this.events.push('rampOut');
    }
  }

  _sensors(b) {
    // top lanes
    if ((b.py - LANE_SENSE) * (b.y - LANE_SENSE) <= 0 && b.py !== b.y) {
      for (let i = 0; i < 3; i++) if (Math.abs(b.x - LANES[i].x) < 20) this._lane(i);
    }
    // spinner
    if (b.x < ORBIT_X && (b.py - SPINNER_Y) * (b.y - SPINNER_Y) <= 0 && b.py !== b.y) {
      this.spin.w += Math.sign(b.vy || 1) * Math.min(Math.abs(b.vy), 2600) / 62;
      this.events.push('spinStart');
      if (b.vy < -600) this._orbit();
    }
    // ramp capture
    if (b.x > RAMP_X0 && b.x < RAMP_X1 && b.vy < 0 && b.py >= RAMP_CAP_Y && b.y < RAMP_CAP_Y) {
      const v = -b.vy;
      if (v > 640) { b.ramp = { s: 0, v: v * 0.92 }; this._ramp(); }
    }
    // inlanes / outlanes (once per pass)
    const zone = b.y > 600 && b.y < 700 ? (b.x < 45 ? 'lo' : b.x < 80 ? 'li' : b.x > 327 && b.x < SHOOTER.x0 ? 'ro' : b.x > 292 ? 'ri' : null) : null;
    if (zone && zone !== b.zone) this._zone(zone);
    b.zone = zone;
    // saucer
    const dx = b.x - SAUCER.x, dy = b.y - SAUCER.y;
    if (dx * dx + dy * dy < 12 * 12 && Math.hypot(b.vx, b.vy) < 760) this._saucer(b);
    // skill shot fails on anything but a lane: the first real switch after the plunge
    if (this.skillLive && b.launched && b.x < SHOOTER.x0 && b.y > 160) this.skillLive = false;
  }

  _ballFrame(b, dt) {
    if (b.held > 0) {
      b.held -= dt;
      b.x += (SAUCER.x - b.x) * Math.min(1, dt * 12); b.y += (SAUCER.y - b.y) * Math.min(1, dt * 12);
      if (b.held <= 0) {
        b.held = 0;
        b.vx = -110 - this.rng() * 40; b.vy = 480 + this.rng() * 60;
        b.x = SAUCER.x - 4; b.y = SAUCER.y + 14;
        this.events.push('kickout');
      }
      return;
    }
    if (b.ramp || b.locked) return;
    // kickback
    if (b.x < 45 && b.y > 690 && b.y < 790 && b.vy > 0) {
      if (this.kickback && !this.tilted) {
        this.kickback = false;
        b.vx = 0; b.vy = -1750; b.x = 30;
        this._msg('KICKBACK', '', 1.4);
        this.events.push('kickback');
      }
    }
    // a ball at rest anywhere but the plunger, the saucer or a raised flipper gets a shove
    const slow = Math.hypot(b.vx, b.vy) < 12;
    const cradled = b.onFlip && this.flips[b.onFlip - 1].on;
    if (slow && !cradled && !(b.x > SHOOTER.x0 && b.y > 600)) b.still += dt; else b.still = 0;
    if (b.still > 3) { b.still = 0; b.vx = (this.rng() - 0.5) * 300; b.vy = -250; this.events.push('thud'); }
    b.onFlip = 0;
  }

  _drains() {
    const gone = this.balls.filter((b) => !b.locked && !b.ramp && b.held <= 0 && (b.y > H + R * 2 || b.x < -R || b.x > W + R || b.y < -60));
    if (!gone.length) return;
    this.balls = this.balls.filter((b) => !gone.includes(b));
    for (let i = 0; i < gone.length; i++) {
      const live = this.balls.filter((b) => !b.locked).length + this.pending.length;
      if (this.save > 0 && !this.tilted) {
        this.pending.push(0.9);
        this._msg('BALL SAVED', '', 1.6);
        this.events.push('saved');
        continue;
      }
      if (live > 0) {
        if (this.multiball && live === 1) { this.multiball = false; this.jackpot = false; this._msg('MULTIBALL', 'OVER', 1.6); }
        this.events.push('drainSoft');
        continue;
      }
      this._endBall();
    }
  }

  _endBall() {
    this.events.push('drain');
    this.multiball = false;
    this.jackpot = false;
    this.state = 'bonus';
    this.bonusT = 0;
    this.bonusShown = 0;
    this.bonusTotal = this.tilted ? 0 : this.bonus * this.bonusX;
    this._msg(this.tilted ? 'TILT' : 'BONUS', this.tilted ? 'NO BONUS' : `${this.bonus.toLocaleString('en-US')} X ${this.bonusX}`, 2.2);
  }

  _bonusStep(dt) {
    this.bonusT += dt;
    if (this.bonusT > 0.4 && this.bonusShown < this.bonusTotal) {
      const add = Math.min(this.bonusTotal - this.bonusShown, Math.ceil(this.bonusTotal * dt / 1.2));
      this.bonusShown += add; this.score += add;
      if (Math.floor(this.bonusT * 14) !== Math.floor((this.bonusT - dt) * 14)) this.events.push('count');
    }
    if (this.bonusT > 2.4 && this.bonusShown >= this.bonusTotal) {
      if (this.extra > 0) { this.extra--; this._serve(true); return; }
      if (this.ball >= BALLS) { this.state = 'over'; this.over = true; this._msg('GAME OVER', '', 99); this.events.push('over'); return; }
      this.ball++;
      this._serve(false);
    }
  }

  // --- rules --------------------------------------------------------------------------------

  _score(n, bonus = 0) {
    if (this.tilted) return;
    this.score += n;
    this.bonus += bonus * 1000;
  }

  _msg(a, b, t) { this.msgs.push({ a, b, t }); if (this.msgs.length > 3) this.msgs.shift(); }

  _later(t, fn) { (this._timers || (this._timers = [])).push({ t, fn }); }

  tick(dt) {
    if (!this._timers) return;
    for (const tm of this._timers) tm.t -= dt;
    const due = this._timers.filter((tm) => tm.t <= 0);
    this._timers = this._timers.filter((tm) => tm.t > 0);
    for (const tm of due) tm.fn();
  }

  _lane(i) {
    if (this.skillLive) {
      this.skillLive = false;
      if (i === this.skillLane) { this._score(PTS.skill, 5); this._msg('SKILL SHOT', '250,000', 2.2); this.events.push('skill'); }
    }
    this._score(PTS.lane, 1);
    this.events.push('lane');
    if (!this.lanes[i]) { this.lanes[i] = true; this.laneFlash = 0.3; }
    if (this.lanes.every(Boolean)) {
      this._score(PTS.laneSet, 2);
      this.lanes = [false, false, false];
      if (this.bonusX < 6) { this.bonusX++; this._msg(`BONUS ${this.bonusX}X`, '', 1.8); }
      else this._msg('S E A', 'COMPLETE', 1.4);
      this.events.push('laneSet');
    }
  }

  _spinTick() {
    this._score(PTS.spinner, 0);
    this.spinCount++;
    this.events.push('spin');
    if (this.spinCount >= 60 && !this.kickback) { this.spinCount = 0; this.kickback = true; this._msg('KICKBACK', 'IS LIT', 1.6); this.events.push('lit'); }
  }

  _orbit() { this._score(PTS.orbit, 2); this.events.push('orbit'); }

  _ramp() {
    this.rampCount++;
    this.rampCombo = this.t < (this._comboEnd || 0) ? this.rampCombo + 1 : 1;
    if (this.jackpot) {
      this._score(PTS.jackpot, 10);
      this._msg('JACKPOT', '1,000,000', 2.4);
      this.events.push('jackpot');
    } else {
      this._score(PTS.ramp + 25000 * Math.min(this.rampCombo - 1, 4), 3);
      this._msg('NEEDLE RAMP', `${(PTS.ramp + 25000 * Math.min(this.rampCombo - 1, 4)).toLocaleString('en-US')}`, 1.5);
      this.events.push('ramp');
    }
    if (this.rampCount >= this.ebAt) {
      this.ebAt += 10; this.ebLit = true; this._msg('EXTRA BALL', 'IS LIT', 2); this.events.push('lit'); }
    this._comboEnd = this.t + 6;
  }

  _zone(z) {
    if (z === 'li' || z === 'ri') { this._score(PTS.inlane, 1); this.events.push('lane'); }
    else { this._score(PTS.outlane, 2); this.events.push('outlane'); }
  }

  _saucer(b) {
    if (b.held > 0) return;
    b.held = 1.1; b.vx = 0; b.vy = 0;
    this._score(PTS.saucer, 2);
    this.events.push('saucer');
    if (this.ebLit) { this.ebLit = false; this.extra++; this._msg('EXTRA BALL', '', 2.2); this.events.push('extraBall'); b.held = 1.8; return; }
    if (this.lockLit && !this.multiball) {
      this.lockLit = false;
      this.locked++;
      this._score(PTS.lock, 5);
      if (this.locked >= 2) {
        this.locked = 0;
        this.multiball = true;
        this.jackpot = true;
        this.save = 12;
        this._msg('MULTIBALL', 'SHOOT THE RAMP', 3);
        this.events.push('multiball');
        b.held = 1.6;
        this.pending.push(1.2, 1.2);
      } else {
        // a virtual lock: the ball is held, a new one comes to the plunger
        this._msg('BALL 1 LOCKED', 'DROP THE BANK AGAIN', 2.4);
        this.events.push('lock');
        this.balls = this.balls.filter((x) => x !== b);
        this.pending.push(1.0);
      }
    }
  }

  _nudge() {
    if (this.tilted || this.state === 'over') return;
    this.tilt += 1;
    for (const b of this.balls) if (!b.ramp && !b.held && !b.locked) { b.vx += (this.rng() - 0.5) * 160; b.vy -= 140; }
    this.events.push('nudge');
    if (this.tilt >= 3.2) {
      this.tilted = true;
      for (const f of this.flips) f.on = false;
      this._msg('TILT', '', 3);
      this.events.push('tilt');
    } else if (this.tilt >= 2) { this._msg('DANGER', '', 1); this.events.push('danger'); }
  }
}

export { rampAt };
