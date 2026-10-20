// HOCKEY NIGHT at Climate Pledge Arena: the game, in the manner of the 16-bit
// hockey classic. Five skaters and a goalie a side, three periods, no menus.
// No DOM and no THREE: hockey.js draws it and feeds it the pad, and Node can
// play it (both benches on the AI) to judge the balance.
//
// Units are feet and seconds. The rink is 200 x 85 with 28 ft corners, x
// along its length, y across it (+y is the near boards on screen). Goal lines
// at x = +-89, blue lines at +-25, nets 6 ft wide and 3.3 ft deep.
//
// What makes it play like the classic, and each is a mechanic here, not a
// script:
// - SKATING HAS MOMENTUM. The stick asks for an acceleration, not a velocity;
//   turning at speed carves, reversing is a hockey stop (snow spray).
// - THE ONE-TIMER. Press SHOOT while a pass is on its way to the player you
//   will control and he shoots it first time on arrival, faster and harder
//   than any shot off the carry. The goalie tracks the puck along his arc at
//   a limited speed, so a pass across the crease and a one-timer beats him
//   where a shot from the same spot would not.
// - CHECKING. SHOOT without the puck is a body check: a lunge that flattens a
//   carrier you hit at speed, puck spilling loose; slow, it is a poke.
// - Wrist shots on a tap, slap shots on a hold (the wind-up leaves you
//   gliding); the stick's vertical at release picks the corner.
// - Goalies play the angle, come out to cut it, react with a delay, make
//   blocker, pad and glove saves, give up rebounds on hard shots and cover
//   soft ones (a faceoff in the zone).
// - Control switches to the pass receiver; on defence PASS switches to the
//   skater nearest the puck, and losing the puck does so automatically.

export const RINK = { hx: 100, hy: 42.5, corner: 28, goalX: 89, blue: 25, netHalf: 3, netDepth: 3.3 };
export const PERIOD_S = 150;               // game seconds a period (2:30)
export const TEAMS = [
  { name: 'SEATTLE', abbr: 'SEA', jersey: '#10284a', trim: '#6fd3e8', pants: '#0a1830', helmet: '#10284a', num: '#e8f8ff' },
  { name: 'VANCOUVER', abbr: 'VAN', jersey: '#1f6e46', trim: '#f2f2f2', pants: '#10283a', helmet: '#1a3a6a', num: '#ffffff' },
];
const ROLES = ['C', 'LW', 'RW', 'LD', 'RD', 'G'];
const NUMS = [[19, 11, 27, 4, 44, 31], [9, 17, 22, 3, 55, 35]];
const NAMES = [['ANDERSON', 'BERG', 'OKAFOR', 'LINDQVIST', 'MORALES', 'PARK'], ['TREMBLAY', 'SINGH', 'KOVAC', 'MACLEOD', 'NAKAMURA', 'ROY']];

// skating
const MAX_V = 25, MAX_V_PUCK = 22, ACC = 40, STOP = 58, GLIDE = 5, PR = 1.5;
// puck
const ICE_F = 7, BOARD_E = 0.55, PUCK_G = 32;
const REACH = 2.7;                         // stick reach for a loose puck
const WRIST_V = 72, SLAP_V0 = 80, SLAP_V1 = 108, ONE_T_V = 98, PASS_V = 62;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const len = (x, y) => Math.hypot(x, y);

/** Is a point inside the rink's rounded rectangle (shrunk by r)? Returns the push-out normal when not. */
export function boardHit(x, y, r) {
  const hx = RINK.hx - r, hy = RINK.hy - r, c = RINK.corner - r;
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax > hx - c && ay > hy - c) {
    const cx = (hx - c) * Math.sign(x), cy = (hy - c) * Math.sign(y);
    const dx = x - cx, dy = y - cy, d = len(dx, dy);
    if (d > c) return { nx: -dx / d, ny: -dy / d, pen: d - c };
    return null;
  }
  if (ax > hx) return { nx: -Math.sign(x), ny: 0, pen: ax - hx };
  if (ay > hy) return { nx: 0, ny: -Math.sign(y), pen: ay - hy };
  return null;
}

export class Hockey {
  /** opts: { rng, humanTeam: 0 | null } (null: both benches on the AI) */
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.human = opts.humanTeam === undefined ? 0 : opts.humanTeam;
    this.score = [0, 0];
    this.shots = [0, 0];
    this.period = 1;
    this.clock = PERIOD_S;
    this.over = false;
    this.t = 0;
    this.events = [];
    this.msg = null;               // { text, sub, t }
    this.players = [];
    for (let team = 0; team < 2; team++) {
      for (let i = 0; i < 6; i++) {
        this.players.push({
          team, i, role: ROLES[i], goalie: i === 5, num: NUMS[team][i], name: NAMES[team][i],
          x: 0, y: 0, vx: 0, vy: 0, face: 0, down: 0, check: 0, checkCd: 0, windup: 0, stride: 0,
          skill: (this.human === team ? 0.86 : 0.74) + this.rng() * 0.14, ai: { t: 0, tx: 0, ty: 0, want: null }, hasPuck: false, pickCd: 0, oneT: false, save: 0, stopT: 0,
        });
      }
    }
    this.puck = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null, last: null, lastTeam: -1, pass: null, shot: null, frozen: 0, trail: [] };
    this.ctl = this.human === null ? null : this.players[this.human * 6];
    this.state = 'faceoff';        // faceoff | play | goal | stop | intermission | final
    this.stateT = 0;
    this.sprays = [];
    this._faceoff(0, 0, 'OPENING FACEOFF');
    this.stats = { onNet: [0, 0], passes: [0, 0], oneTimers: [0, 0], checks: [0, 0], saves: [0, 0], goalsOneT: [0, 0] };
  }

  /** Team `team` attacks toward +x (1) or -x (-1); they change ends each period. */
  dir(team) { const d = team === 0 ? 1 : -1; return this.period % 2 === 1 ? d : -d; }
  netX(team) { return -this.dir(team) * RINK.goalX; }       // the net a team DEFENDS

  // --- the frame -------------------------------------------------------------------------

  /** input: { x, y (-1..1 stick), shoot, pass (held) } for the human's skater. */
  step(dt, input = {}) {
    this.t += dt;
    this.stateT += dt;
    if (this.msg) { this.msg.t -= dt; if (this.msg.t <= 0) this.msg = null; }
    const inp = { x: input.x || 0, y: input.y || 0, shoot: !!input.shoot, pass: !!input.pass };
    const edge = { shoot: inp.shoot && !this._prevShoot, pass: inp.pass && !this._prevPass, shootUp: !inp.shoot && this._prevShoot };
    this._prevShoot = inp.shoot; this._prevPass = inp.pass;
    this._lastInpY = inp.y;

    if (this.state === 'final') return;
    if (this.state === 'intermission') {
      if (this.stateT > 3) this._faceoff(0, 0, `PERIOD ${this.period}`);
      return;
    }
    if (this.state === 'goal' || this.state === 'stop') {
      // players drift to a stop; the puck lies where it is
      for (const p of this.players) this._skate(p, 0, 0, dt, false);
      this._puckFree(dt);
      if (this.stateT > (this.state === 'goal' ? 3.2 : 1.2)) {
        if (this.state === 'goal' && this.period >= 4) this._final();      // sudden death
        else if (this.state === 'goal') this._faceoff(0, 0, '');
        else this._faceoff(this.stopAt.x, this.stopAt.y, '');
      }
      return;
    }
    if (this.state === 'faceoff') { this._faceoffStep(dt, inp, edge); return; }

    // --- play ---
    this.clock -= dt;
    if (this.clock <= 0) { this._periodEnd(); return; }
    // the human
    if (this.ctl && this.ctl.down <= 0) this._humanStep(this.ctl, inp, edge, dt);
    // the rest
    for (const p of this.players) if (p !== this.ctl || p.down > 0) this._aiStep(p, dt);
    this._collide(dt);
    this._puckStep(dt);
    for (const s of this.sprays) s.t -= dt;
    this.sprays = this.sprays.filter((s) => s.t > 0);
  }

  takeEvents() { const e = this.events; this.events = []; return e; }

  // --- the human's skater ---------------------------------------------------------------------

  _humanStep(p, inp, edge, dt) {
    const pk = this.puck;
    const mine = pk.owner === p;
    const teamHas = pk.owner && pk.owner.team === p.team;
    let ax = inp.x, ay = inp.y;
    const m = len(ax, ay);
    if (m > 1) { ax /= m; ay /= m; }
    if (p.goalie) { this._goalie(p, dt); return; }
    // slap shot wind-up: holding SHOOT with the puck
    if (mine) {
      if (edge.shoot) { p.windup = 0.0001; }
      if (p.windup > 0 && inp.shoot) { p.windup += dt; ax *= 0.15; ay *= 0.15; }
      if (p.windup > 0 && edge.shootUp) {
        const slap = p.windup > 0.22;
        this._shoot(p, slap ? SLAP_V0 + (SLAP_V1 - SLAP_V0) * clamp((p.windup - 0.22) / 0.5, 0, 1) : WRIST_V, inp.y, slap ? 'slap' : 'wrist');
        p.windup = 0;
      }
      if (edge.pass) this._pass(p, inp.x, inp.y);
    } else {
      p.windup = 0;
      if (edge.shoot) {
        // a pass on its way to me: the one-timer. Otherwise a check (or a poke).
        if (pk.pass && pk.pass.to === p) { p.oneT = true; this.events.push('oneTimerArmed'); }
        else if (!teamHas) this._check(p, ax, ay);
        else if (pk.owner) this._call(p);
      }
      if (edge.pass) {
        if (!teamHas) this._switch(p.team, true);
        else if (pk.owner) this._call(p);
      }
    }
    this._skate(p, ax, ay, dt, mine);
  }

  /** Calling for the puck: a teammate carrying it passes to you. */
  _call(p) {
    const c = this.puck.owner;
    if (!c || c === p || c.team !== p.team || c.windup > 0 || len(c.x - p.x, c.y - p.y) < 6) return;
    this.events.push('call');
    this._pass(c, 0, 0, p);
  }

  _switch(team, manual) {
    if (this.human !== team) return;
    const pk = this.puck;
    let best = null, bd = 1e9;
    for (const q of this.players) {
      if (q.team !== team || q.goalie || q.down > 0) continue;
      if (manual && q === this.ctl) continue;
      const d = len(q.x - pk.x, q.y - pk.y);
      if (d < bd) { bd = d; best = q; }
    }
    if (best) { this.ctl = best; this.events.push('switch'); }
  }

  // --- skating -------------------------------------------------------------------------------

  _skate(p, ax, ay, dt, carrying) {
    if (p.down > 0) {
      p.down -= dt;
      const k = Math.max(0, 1 - 5 * dt); p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
      this._boards(p);
      return;
    }
    const m = len(ax, ay);
    const vmax = (carrying ? MAX_V_PUCK : MAX_V) * (0.92 + 0.1 * p.skill) * (p.check > 0 ? 1.25 : 1);
    if (m > 0.1) {
      const ux = ax / m, uy = ay / m;
      const sp = len(p.vx, p.vy);
      // pushing against your own speed is a hockey stop
      const along = sp > 0.1 ? (p.vx * ux + p.vy * uy) / sp : 1;
      const a = along < -0.2 ? STOP : ACC;
      p.vx += ux * a * m * dt; p.vy += uy * a * m * dt;
      if (along < -0.2 && sp > 14) { p.stopT += dt; if (p.stopT > 0.05) { this.sprays.push({ x: p.x, y: p.y, t: 0.35, a: Math.atan2(p.vy, p.vx) }); this.events.push('stop'); p.stopT = -0.3; } }
      p.face = Math.atan2(uy, ux);
    } else {
      const sp = len(p.vx, p.vy);
      if (sp > 0) { const k = Math.max(0, sp - GLIDE * dt) / sp; p.vx *= k; p.vy *= k; }
    }
    const sp = len(p.vx, p.vy);
    if (sp > vmax) { p.vx *= vmax / sp; p.vy *= vmax / sp; }
    if (sp > 3 && m <= 0.1) p.face = Math.atan2(p.vy, p.vx);
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.stride += sp * dt * 0.35;
    if (p.check > 0) p.check -= dt;
    if (p.checkCd > 0) p.checkCd -= dt;
    if (p.pickCd > 0) p.pickCd -= dt;
    this._boards(p);
    // skaters stay out of the nets
    for (const s of [-1, 1]) {
      const nx = s * RINK.goalX, bx = nx + s * RINK.netDepth / 2;
      const dx = p.x - bx, dy = p.y;
      if (Math.abs(dx) < RINK.netDepth / 2 + PR && Math.abs(dy) < RINK.netHalf + PR) {
        const px = RINK.netDepth / 2 + PR - Math.abs(dx), py = RINK.netHalf + PR - Math.abs(dy);
        if (px < py) { p.x += Math.sign(dx || 1) * px; p.vx *= -0.3; } else { p.y += Math.sign(dy || 1) * py; p.vy *= -0.3; }
      }
    }
  }

  _boards(p) {
    const h = boardHit(p.x, p.y, PR);
    if (!h) return;
    p.x += h.nx * h.pen; p.y += h.ny * h.pen;
    const vn = p.vx * h.nx + p.vy * h.ny;
    if (vn < 0) {
      p.vx -= 1.4 * vn * h.nx; p.vy -= 1.4 * vn * h.ny;
      if (vn < -14) { this.events.push('boards'); if (p.hasPuck && vn < -20 && this.rng() < 0.3) this._lose(p, 0.5); }
    }
  }

  _collide() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy), R2 = a.goalie || b.goalie ? 3.4 : 3.0;
      if (d >= R2 || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, pen = R2 - d;
      // a goalie is planted
      const wa = a.goalie ? 0.1 : 0.5, wb = b.goalie ? 0.1 : 0.5, ws = wa + wb;
      a.x -= nx * pen * wa / ws; a.y -= ny * pen * wa / ws; b.x += nx * pen * wb / ws; b.y += ny * pen * wb / ws;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv >= 0) continue;
      // a check: the one lunging, into an opponent, at speed
      if (a.team !== b.team && (a.check > 0 || b.check > 0) && !a.goalie && !b.goalie) {
        const hitter = a.check > 0 ? a : b, victim = hitter === a ? b : a;
        // the closing speed, and the hitter's own speed into the victim
        const hv = -rv, own = (hitter === a ? 1 : -1) * (hitter.vx * nx + hitter.vy * ny);
        if (hv > 11 && own > 8 && victim.down <= 0) {
          victim.down = 1.1 + this.rng() * 0.5;
          victim.vx = hitter.vx * 0.7; victim.vy = hitter.vy * 0.7;
          hitter.vx *= 0.35; hitter.vy *= 0.35; hitter.check = 0;
          if (victim.hasPuck) this._lose(victim, 0.7);
          this.stats.checks[hitter.team]++;
          this.events.push('check');
          if (this.ctl === victim) this._switch(victim.team, false);
          continue;
        }
      }
      const j2 = -rv * 0.6;
      a.vx -= nx * j2 * wa / ws * 2; a.vy -= ny * j2 * wa / ws * 2; b.vx += nx * j2 * wb / ws * 2; b.vy += ny * j2 * wb / ws * 2;
      if (-rv > 16) this.events.push('bump');
    }
  }

  _check(p, ax, ay) {
    if (p.checkCd > 0 || p.down > 0) return;
    const pk = this.puck;
    const sp = len(p.vx, p.vy);
    const car = pk.owner;
    // slow and close to the carrier: a poke at the puck
    if (car && car.team !== p.team && len(car.x - p.x, car.y - p.y) < 6 && sp < 12) {
      p.checkCd = 0.5;
      this.events.push('poke');
      if (this.rng() < 0.45 + 0.2 * (p.skill - car.skill)) this._lose(car, 0.4, p);
      return;
    }
    // a lunge
    let ux = ax, uy = ay, m = len(ux, uy);
    if (m < 0.1) { ux = Math.cos(p.face); uy = Math.sin(p.face); m = 1; }
    p.vx += ux / m * 9; p.vy += uy / m * 9;
    p.check = 0.45; p.checkCd = 0.9;
    this.events.push('lunge');
  }

  // --- the puck ---------------------------------------------------------------------------------

  _take(p) {
    const pk = this.puck;
    if (pk.owner) pk.owner.hasPuck = false;
    const oneT = p.oneT || (p.ai.oneT && p !== this.ctl);
    const prevTeam = pk.lastTeam;
    const wasPass = pk.pass && pk.pass.to === p;
    pk.owner = p; p.hasPuck = true; pk.pass = null; pk.shot = null; pk.z = 0; pk.vz = 0;
    pk.last = p; pk.lastTeam = p.team;
    p.oneT = false; p.ai.oneT = false;
    if (wasPass && oneT) {
      // first time, off the pass
      this.stats.oneTimers[p.team]++;
      this._shoot(p, ONE_T_V * (0.95 + 0.1 * p.skill), p === this.ctl ? this._lastInpY || 0 : (this.rng() - 0.5) * 1.6, 'onetimer');
      return;
    }
    this.events.push('pickup');
    if (this.human === p.team && prevTeam !== p.team) this.ctl = p;
    else if (this.human === p.team && wasPass) this.ctl = p;
    else if (this.human === p.team && this.ctl && this.ctl.team === p.team && !this.ctl.hasPuck && p !== this.ctl) this.ctl = p;
    // the other bench: switch the human to his skater nearest the puck
    if (this.human !== null && this.human !== p.team && prevTeam !== p.team) this._switch(this.human, false);
  }

  _lose(p, spd, by) {
    const pk = this.puck;
    p.hasPuck = false;
    pk.owner = null;
    pk.vx = p.vx * spd + (this.rng() - 0.5) * 14; pk.vy = p.vy * spd + (this.rng() - 0.5) * 14;
    p.pickCd = 0.6;
    this.events.push('loose');
    if (by) { by.pickCd = 0; }
  }

  _pass(p, sx, sy, target) {
    const pk = this.puck;
    // the teammate most in the stick's direction, else the most open ahead
    let best = target || null, bs = -1e9;
    const hasDir = len(sx, sy) > 0.3;
    for (const q of target ? [] : this.players) {
      if (q.team !== p.team || q === p || q.goalie || q.down > 0) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = len(dx, dy);
      if (d < 6) continue;
      let s;
      if (hasDir) s = (dx * sx + dy * sy) / (d * len(sx, sy)) * 50 - d * 0.15;
      else s = this.dir(p.team) * dx * 0.4 - d * 0.1 - this._laneRisk(p, q) * 30;
      if (s > bs) { bs = s; best = q; }
    }
    if (!best) { this._shoot(p, 40, 0, 'dump'); return; }
    // lead the receiver
    const d = len(best.x - p.x, best.y - p.y), tt = d / PASS_V;
    const tx = best.x + best.vx * tt * 0.8, ty = best.y + best.vy * tt * 0.8;
    const dx = tx - p.x, dy = ty - p.y, dd = len(dx, dy) || 1;
    const err = (this.rng() - 0.5) * 0.08 * (1.2 - p.skill);
    const a = Math.atan2(dy, dx) + err;
    const v = clamp(PASS_V * (0.75 + dd / 160), 42, 76);
    p.hasPuck = false; pk.owner = null;
    pk.x = p.x + Math.cos(a) * 2.6; pk.y = p.y + Math.sin(a) * 2.6;
    pk.vx = Math.cos(a) * v; pk.vy = Math.sin(a) * v; pk.z = 0; pk.vz = 0;
    pk.pass = { to: best, from: p, t: 0 };
    p.pickCd = 0.35;
    this.stats.passes[p.team]++;
    this.events.push('pass');
    // control follows the pass
    if (this.human === p.team) this.ctl = best;
    // an AI receiver in shooting position takes it first time
    if (best !== this.ctl) {
      const gx = -this.netX(best.team);
      const ddist = len(gx - best.x, best.y);
      best.ai.oneT = ddist < 42 && Math.abs(best.y) < 26 && this.rng() < 0.55;
    }
  }

  /** How exposed the lane from a to b is to the other team. */
  _laneRisk(a, b, skaters) {
    let r = 0;
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    for (const o of this.players) {
      if (o.team === a.team || o.down > 0 || (skaters && o.goalie)) continue;
      const t = clamp(((o.x - a.x) * dx + (o.y - a.y) * dy) / L2, 0, 1);
      const d = len(a.x + dx * t - o.x, a.y + dy * t - o.y);
      if (d < 6) r += (6 - d) / 6;
    }
    return r;
  }

  _shoot(p, v, aimY, kind) {
    const pk = this.puck;
    const gx = -this.netX(p.team);
    // aim at a corner by the stick's vertical, with an error that grows with range and hurry
    const dist = len(gx - p.x, p.y);
    const aim = clamp(aimY * 2.6 + (this.rng() - 0.5) * 1.2, -2.85, 2.85);
    const err = (this.rng() - 0.5) * (0.6 + dist * 0.045) * (kind === 'slap' ? 1.3 : kind === 'onetimer' ? 0.8 : 1) * (1.25 - p.skill * 0.5);
    const tx = gx, ty = kind === 'dump' ? Math.sign(p.y || 1) * 30 : aim + err;
    const a = Math.atan2(ty - p.y, tx - p.x);
    p.hasPuck = false; pk.owner = null; pk.pass = null;
    pk.x = p.x + Math.cos(a) * 2.4; pk.y = p.y + Math.sin(a) * 2.4;
    pk.vx = Math.cos(a) * v; pk.vy = Math.sin(a) * v;
    pk.z = 0.2;
    pk.vz = kind === 'slap' ? 4 + this.rng() * 9 : kind === 'dump' ? 10 : 2 + this.rng() * 7;
    pk.shot = kind === 'dump' ? null : { by: p, team: p.team, kind, v, t: 0 };
    pk.last = p; pk.lastTeam = p.team;
    p.pickCd = 0.4;
    // a shot on goal: one that would cross the line between the posts
    if (kind !== 'dump') {
      const tt = (gx - pk.x) / (pk.vx || 1e-6);
      if (tt > 0 && Math.abs(pk.y + pk.vy * tt) < RINK.netHalf) { this.shots[p.team]++; this.stats.onNet[p.team]++; }
    }
    this.events.push(kind === 'slap' ? 'slap' : kind === 'onetimer' ? 'onetimer' : kind === 'dump' ? 'dump' : 'wrist');
    // the goalie reads it from the release
    const g = this.players[(1 - p.team) * 6 + 5];
    g.ai.read = 0.1 + this.rng() * 0.1 + (kind === 'onetimer' ? 0.07 : 0) + (p.team === this.human ? 0.04 : 0);
  }

  _puckStep(dt) {
    const pk = this.puck;
    if (pk.frozen > 0) return;
    const o = pk.owner;
    if (o) {
      // on the blade: ahead of the carrier, a little to the forehand, with a dribble
      const f = o.face, dr = Math.sin(this.t * 9 + o.i) * 0.35;
      const tx = o.x + Math.cos(f) * 2.4 - Math.sin(f) * dr, ty = o.y + Math.sin(f) * 2.4 + Math.cos(f) * dr;
      pk.vx = (tx - pk.x) / dt; pk.vy = (ty - pk.y) / dt;
      pk.x = tx; pk.y = ty; pk.z = 0;
      const h = boardHit(pk.x, pk.y, 0.5);
      if (h) { pk.x += h.nx * h.pen; pk.y += h.ny * h.pen; }
      // stick checks: an opponent's blade on the puck
      for (const q of this.players) {
        if (q.team === o.team || q.down > 0 || q.goalie || q.pickCd > 0) continue;
        const d = len(q.x + Math.cos(q.face) * 2.2 - pk.x, q.y + Math.sin(q.face) * 2.2 - pk.y);
        const rate = (o === this.ctl ? 0.9 : 1.6) + 2 * (q.skill - o.skill);
        if (d < 1.8 && this.rng() < dt * rate) { this._lose(o, 0.3, q); break; }
      }
      return;
    }
    this._puckFree(dt);
    if (this.state !== 'play') return;
    // pickups: the nearest blade in reach, if the puck is not going too fast for it
    const sp = len(pk.vx, pk.vy);
    let best = null, bd = 1e9;
    for (const q of this.players) {
      if (q.down > 0 || q.pickCd > 0 || q.goalie) continue;
      const bx = q.x + Math.cos(q.face) * 1.6, by = q.y + Math.sin(q.face) * 1.6;
      const d = len(bx - pk.x, by - pk.y);
      const rel = len(pk.vx - q.vx, pk.vy - q.vy);
      const intended = pk.pass && pk.pass.to === q;
      const lim = intended ? 95 : pk.shot ? 30 : 48;
      if (d < REACH + (intended ? 0.8 : 0) && rel < lim && pk.z < 3 && d < bd) { bd = d; best = q; }
    }
    if (best) this._take(best);
  }

  _puckFree(dt) {
    const pk = this.puck;
    if (pk.frozen > 0) { pk.frozen -= dt; return; }
    const steps = Math.ceil(len(pk.vx, pk.vy) * dt / 0.8) || 1;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      const px = pk.x;
      pk.x += pk.vx * h; pk.y += pk.vy * h;
      if (pk.z > 0 || pk.vz > 0) {
        pk.vz -= PUCK_G * h; pk.z += pk.vz * h;
        if (pk.z < 0) { pk.z = 0; pk.vz = pk.vz < -6 ? -pk.vz * 0.3 : 0; }
      } else {
        const sp = len(pk.vx, pk.vy);
        if (sp > 0) { const k = Math.max(0, sp - ICE_F * h) / sp; pk.vx *= k; pk.vy *= k; }
      }
      // the goalies, every substep: a hard shot crosses a goalie and the line in one frame
      if (this.state === 'play' && this._goalies()) return;
      // boards
      const b = boardHit(pk.x, pk.y, 0.5);
      if (b) {
        pk.x += b.nx * b.pen; pk.y += b.ny * b.pen;
        const vn = pk.vx * b.nx + pk.vy * b.ny;
        if (vn < 0) { pk.vx -= (1 + BOARD_E) * vn * b.nx; pk.vy -= (1 + BOARD_E) * vn * b.ny; if (vn < -12) this.events.push('boardsPuck'); }
        if (pk.z > 4 && Math.abs(vn) > 40 && this.rng() < 0.5) { this._stoppage(pk.x, pk.y, 'OUT OF PLAY'); return; }
      }
      // nets: the goal line between the posts is the mouth; posts, sides and back are frame
      for (const sd of [-1, 1]) {
        const gx = sd * RINK.goalX, back = gx + sd * RINK.netDepth;
        // a goal: crossing the line inside the posts, going in, under the bar
        if (this.state === 'play' && (px - gx) * sd < 0 && (pk.x - gx) * sd >= 0 && Math.abs(pk.y) < RINK.netHalf && pk.z < 4) {
          const scorer = sd === this.netX(0) / RINK.goalX ? 1 : 0;       // the net team 0 defends: team 1 scores
          this._goal(scorer);
          pk.vx *= 0.2; pk.vy *= 0.2;
          return;
        }
        // posts
        for (const py of [-RINK.netHalf, RINK.netHalf]) {
          const dx = pk.x - gx, dy = pk.y - py, d = len(dx, dy);
          if (d < 0.6 && pk.z < 4) {
            const nx = dx / d, ny = dy / d, vn = pk.vx * nx + pk.vy * ny;
            pk.x = gx + nx * 0.6; pk.y = py + ny * 0.6;
            if (vn < 0) { pk.vx -= 1.7 * vn * nx; pk.vy -= 1.7 * vn * ny; this.events.push('post'); if (pk.shot) pk.shot.post = true; }
          }
        }
        // the frame: back and sides are walls from inside and out; the mouth is open
        for (const w of [[back, -RINK.netHalf, back, RINK.netHalf], [gx, -RINK.netHalf, back, -RINK.netHalf], [gx, RINK.netHalf, back, RINK.netHalf]]) {
          if (pk.z > 4.2) continue;
          const ex = w[2] - w[0], ey = w[3] - w[1], L2 = ex * ex + ey * ey;
          const tt = clamp(((pk.x - w[0]) * ex + (pk.y - w[1]) * ey) / L2, 0, 1);
          const qx = w[0] + ex * tt, qy = w[1] + ey * tt, dx = pk.x - qx, dy = pk.y - qy, dd = len(dx, dy);
          if (dd >= 0.35) continue;
          // which side it came from: where it was a substep ago
          let nx = dx / (dd || 1), ny = dy / (dd || 1);
          if (dd < 1e-4) { nx = ey ? Math.sign(px - qx) || 1 : 0; ny = ex ? Math.sign(pk.y - qy) || 1 : 0; }
          pk.x = qx + nx * 0.35; pk.y = qy + ny * 0.35;
          const vn = pk.vx * nx + pk.vy * ny;
          if (vn < 0) { pk.vx -= 1.35 * vn * nx; pk.vy -= 1.35 * vn * ny; }
        }
      }
    }
    if (pk.pass) { pk.pass.t += dt; if (pk.pass.t > 2) pk.pass = null; }
    if (pk.shot) { pk.shot.t += dt; if (pk.shot.t > 1.5) pk.shot = null; }
  }

  // --- goalies --------------------------------------------------------------------------------

  /** A save by either goalie, if the puck has reached him. True when the puck was played. */
  _goalies() {
    const pk = this.puck;
    for (let team = 0; team < 2; team++) {
      const g = this.players[team * 6 + 5];
      if (g.down > 0) continue;
      const gx = this.netX(team), sd = Math.sign(gx);
      // the puck reaching the goalie's plane
      if ((pk.x - g.x) * sd < 0 || Math.abs(pk.x - g.x) > 2.2 || pk.z > 6) continue;
      if (pk.vx * sd <= 0) continue;
      const reach = g.ai.reach || 2.0;
      if (Math.abs(pk.y - g.y) > reach) continue;
      // a save
      const sp = len(pk.vx, pk.vy);
      const shot = pk.shot;
      if (shot && shot.team !== team) { this.stats.saves[team]++; if (!shot.saved) shot.saved = true; }
      g.save = 0.35;
      this.events.push('save');
      if (sp < 40 || (pk.z > 2.5 && this.rng() < 0.45) || this.rng() < 0.18) {
        // covered, or caught: a whistle
        pk.vx = 0; pk.vy = 0; pk.z = 0; pk.x = g.x + sd * -0.5; pk.y = g.y;
        pk.last = g; pk.lastTeam = team; pk.shot = null; pk.pass = null;
        this.events.push('cover');
        this._stoppage(gx - sd * 20, Math.sign(g.y || (this.rng() - 0.5)) * 22, pk.z > 2 ? 'GLOVE SAVE' : 'COVERED');
        return true;
      }
      // a rebound out into the slot or to a corner
      const ang = (sd > 0 ? Math.PI : 0) + (this.rng() - 0.5) * 2.2;
      const rs = sp * (0.25 + this.rng() * 0.25);
      pk.vx = Math.cos(ang) * rs; pk.vy = Math.sin(ang) * rs; pk.vz = 0; pk.z = 0;
      pk.x = g.x - sd * 1.2 + Math.cos(ang) * 0.5; pk.y = g.y + Math.sin(ang) * 0.5;
      pk.shot = null; pk.pass = null; pk.last = g; pk.lastTeam = team;
      this.events.push('rebound');
      return true;
    }
    return false;
  }

  _goalie(g, dt) {
    const pk = this.puck, gx = this.netX(g.team), sd = Math.sign(gx);
    if (g.save > 0) g.save -= dt;
    // play the angle: on an arc in front of the net, out further as the puck comes closer to the middle
    const dx = (pk.x - gx) * -sd, dy = pk.y;
    let ang = Math.atan2(dy, Math.max(0.5, dx));
    ang = clamp(ang, -1.25, 1.25);
    const dist = len(dx, dy);
    const out = clamp(4.2 - dist * 0.02, 1.6, 4.2) * (Math.abs(ang) > 1 ? 0.6 : 1);
    let tx = gx - sd * (0.8 + Math.cos(ang) * out), ty = clamp(Math.sin(ang) * out, -RINK.netHalf - 0.8, RINK.netHalf + 0.8);
    // a shot on its way: go to where it will cross, after the read
    let spd = 13;
    const shot = pk.shot && pk.shot.team !== g.team && pk.vx * sd > 0;
    if (shot) {
      g.ai.read = (g.ai.read || 0) - dt;
      const tt = (g.x - pk.x) / (pk.vx || 1e-6);
      const cy = pk.y + pk.vy * Math.max(0, tt);
      if (g.ai.read <= 0) { ty = clamp(cy, -RINK.netHalf - 1, RINK.netHalf + 1); spd = 17; }
      else { ty = g.y; spd = 0; }
      // the stretch: pads and glove reach further the longer he has seen it
      g.ai.reach = 1.0 + clamp(-g.ai.read, 0, 0.3) * 2.3 + g.skill * 0.2;
    } else g.ai.reach = 1.3 + g.skill * 0.2;
    // a carrier walking out from behind the net: hug the post
    if (pk.owner && pk.owner.team !== g.team && (pk.x - gx) * sd > 0) { tx = gx - sd * 0.9; ty = Math.sign(pk.y || 1) * (RINK.netHalf - 0.4); }
    const mx = tx - g.x, my = ty - g.y, md = len(mx, my);
    const step = Math.min(md, spd * dt);
    if (md > 1e-4) { g.x += mx / md * step; g.y += my / md * step; g.vx = mx / md * step / dt; g.vy = my / md * step / dt; }
    else { g.vx = 0; g.vy = 0; }
    g.face = sd > 0 ? Math.PI : 0;
    // a loose puck at his feet: cover it
    if (!pk.owner && !pk.shot && pk.frozen <= 0 && len(pk.x - g.x, pk.y - g.y) < 2.4 && len(pk.vx, pk.vy) < 25 && this.state === 'play') {
      pk.vx = 0; pk.vy = 0;
      this.events.push('cover');
      this._stoppage(gx - sd * 20, (pk.y >= 0 ? 1 : -1) * 22, 'COVERED');
    }
  }

  // --- the AI -------------------------------------------------------------------------------------

  _aiStep(p, dt) {
    if (p.goalie) { this._goalie(p, dt); return; }
    if (p.down > 0) { this._skate(p, 0, 0, dt, false); return; }
    const pk = this.puck, team = p.team, d = this.dir(team);
    const own = pk.owner, mine = own === p;
    const teamHas = own && own.team === team;
    const oppHas = own && own.team !== team;
    const ai = p.ai;
    ai.t -= dt;
    let tx, ty, urgency = 1;

    if (mine) {
      this._carrier(p, dt);
      return;
    }
    // an incoming pass: meet it
    if (pk.pass && pk.pass.to === p) {
      const tt = clamp(len(pk.x - p.x, pk.y - p.y) / (len(pk.vx, pk.vy) + 1), 0, 1);
      tx = pk.x + pk.vx * tt; ty = pk.y + pk.vy * tt;
      this._seek(p, tx, ty, dt, 0.8);
      return;
    }
    if (!own) {
      // a loose puck: the nearest two of each side go for it (predicted), the rest hold shape
      const rank = this._rankTo(p, pk.x, pk.y);
      if (rank < (pk.shot ? 1 : 2)) {
        const tt = clamp(len(pk.x - p.x, pk.y - p.y) / 30, 0, 0.8);
        this._seek(p, pk.x + pk.vx * tt * 0.7, pk.y + pk.vy * tt * 0.7, dt, 1);
        return;
      }
      [tx, ty] = this._shape(p, pk.lastTeam === team);
      this._seek(p, tx, ty, dt, 0.8);
      return;
    }
    if (teamHas) {
      [tx, ty] = this._shape(p, true);
      // get open: away from the nearest marker
      const o = this._nearestOpp(p);
      if (o && o.d < 7) { tx += (p.x - o.p.x) / o.d * 5; ty += (p.y - o.p.y) / o.d * 5; }
      this._seek(p, tx, ty, dt, 0.85);
      return;
    }
    if (oppHas) {
      // the nearest pressures the carrier and checks him; the rest mark
      const rank = this._rankTo(p, own.x, own.y);
      if (rank === 0) {
        const gx = this.netX(team);
        // take the carrier's inside line (between him and our net)
        const ix = own.x + (gx - own.x) * 0.12, iy = own.y * 0.9;
        const dd = len(own.x - p.x, own.y - p.y);
        this._seek(p, dd < 9 ? own.x + own.vx * 0.2 : ix, dd < 9 ? own.y + own.vy * 0.2 : iy, dt, 1);
        // the CPU gives the skater you control a little more room than its own carriers
        const agg = team === this.human ? 0.9 : own === this.ctl ? 1.0 : 1.6;
        if (dd < 6.5 && p.checkCd <= 0 && this.rng() < dt * 2.8 * agg) this._check(p, own.x - p.x, own.y - p.y);
        return;
      }
      const m = this._mark(p);
      this._seek(p, m[0], m[1], dt, 0.9);
    }
  }

  /** How many teammates are closer to (x, y) than p. */
  _rankTo(p, x, y) {
    const d0 = len(x - p.x, y - p.y);
    let r = 0;
    for (const q of this.players) if (q.team === p.team && q !== p && !q.goalie && q.down <= 0 && q !== this.ctl && len(x - q.x, y - q.y) < d0) r++;
    // the human's skater counts as the one going for it when he is nearer
    if (this.ctl && this.ctl.team === p.team && this.ctl !== p && len(x - this.ctl.x, y - this.ctl.y) < d0) r++;
    return r;
  }

  _nearestOpp(p) {
    let best = null, bd = 1e9;
    for (const q of this.players) if (q.team !== p.team && !q.goalie) { const d = len(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
    return best ? { p: best, d: bd } : null;
  }

  /** Where a skater stands in his team's shape: attacking or defending, from the puck. */
  _shape(p, attacking) {
    const pk = this.puck, d = this.dir(p.team);
    const px = pk.x * d;                         // puck along our attack direction
    const side = p.role === 'LW' || p.role === 'LD' ? -1 : p.role === 'RW' || p.role === 'RD' ? 1 : 0;
    // "left" for a team skating +x is -y (their left looking up ice)
    const sy = -side * d;
    let x, y;
    if (attacking) {
      if (p.role === 'C') { x = clamp(px + 6, -40, 68); y = clamp(pk.y * 0.3, -10, 10); }
      else if (p.role === 'LW' || p.role === 'RW') { x = clamp(px + 16, -30, 78); y = -sy * 22; }
      else { x = clamp(px - 22, -70, 28); y = -sy * 18; }
    } else {
      if (p.role === 'C') { x = clamp(px - 12, -72, 30); y = clamp(pk.y * 0.5, -14, 14); }
      else if (p.role === 'LW' || p.role === 'RW') { x = clamp(px - 8, -62, 40); y = -sy * 20; }
      else { x = clamp(Math.min(px - 26, -45), -80, -10); y = -sy * 10 + pk.y * 0.25; }
    }
    return [x * d, y];
  }

  /** Mark the attacker this defender is responsible for: between him and our net. */
  _mark(p) {
    const gx = this.netX(p.team);
    let best = null, bd = 1e9;
    const [hx, hy] = this._shape(p, false);
    for (const q of this.players) {
      if (q.team === p.team || q.goalie || q.hasPuck) continue;
      const d = len(q.x - hx, q.y - hy);
      if (d < bd) { bd = d; best = q; }
    }
    if (!best || bd > 35) return [hx, hy];
    return [best.x + (gx - best.x) * 0.15, best.y * 0.85];
  }

  _seek(p, tx, ty, dt, k) {
    const dx = tx - p.x, dy = ty - p.y, d = len(dx, dy);
    // arrive: ease off near the spot, and brake with the momentum
    const want = Math.min(1, d / 6) * k;
    let ax = d > 0.3 ? dx / d * want : 0, ay = d > 0.3 ? dy / d * want : 0;
    // don't glide past: lean against the velocity near the target
    if (d < 8) { ax -= p.vx * 0.03; ay -= p.vy * 0.03; }
    this._skate(p, ax, ay, dt, p.hasPuck);
  }

  _carrier(p, dt) {
    const ai = p.ai, d = this.dir(p.team);
    const gx = -this.netX(p.team);
    const dist = len(gx - p.x, p.y);
    const inZone = (p.x * d) > RINK.blue;
    // pressure: the nearest opponent ahead
    let press = 1e9;
    for (const q of this.players) if (q.team !== p.team && !q.goalie && q.down <= 0) {
      const dd = len(q.x - p.x, q.y - p.y);
      if (dd < press) press = dd;
    }
    ai.hold = (ai.hold || 0) + dt;
    if (p.windup > 0) {
      p.windup += dt;
      if (p.windup > ai.windTo) { this._shoot(p, SLAP_V0 + (SLAP_V1 - SLAP_V0) * clamp((p.windup - 0.22) / 0.5, 0, 1), (this.rng() - 0.5) * 2, 'slap'); p.windup = 0; }
      this._skate(p, 0, 0, dt, true);
      return;
    }
    if (ai.t <= 0) {
      ai.t = 0.24 + this.rng() * 0.16;
      // shoot
      const angleOk = Math.abs(p.y) < 20 + (60 - dist) * 0.2 && (gx - p.x) * d > 4;
      if (inZone && dist < 44 && angleOk && ai.hold > 0.35 && this._laneRisk(p, { x: gx, y: 0 }, true) < 0.6) {
        const pShoot = dist < 18 ? 0.55 : dist < 30 ? 0.2 : 0.04;
        if (this.rng() < pShoot + (press < 6 ? 0.2 : 0)) {
          if (press > 14 && dist > 24 && this.rng() < 0.6) { p.windup = 0.0001; ai.windTo = 0.35 + this.rng() * 0.35; }
          else this._shoot(p, WRIST_V * (0.95 + this.rng() * 0.1), (this.rng() - 0.5) * 2, 'wrist');
          return;
        }
      }
      // pass
      let best = null, bs = -1e9;
      for (const q of this.players) {
        if (q.team !== p.team || q === p || q.goalie || q.down > 0) continue;
        const dd = len(q.x - p.x, q.y - p.y);
        if (dd < 10 || dd > 90) continue;
        const qDist = len(gx - q.x, q.y);
        let s = (dist - qDist) * 0.8 - this._laneRisk(p, q) * 40;
        const o = this._nearestOpp(q);
        if (o) s += Math.min(o.d, 15) * 1.2;
        if (inZone && Math.abs(q.y) < 14 && qDist < 30) s += 10;      // the slot, for the one-timer
        if (s > bs) { bs = s; best = q; }
      }
      const wantPass = best && (bs > 14 || (press < 6 && bs > -4) || (ai.hold > 3.5 && bs > -10));
      if (wantPass && ai.hold > 0.3 && this.rng() < 0.75) { this._pass(p, 0, 0, best); return; }
      // skate: toward the net, dodging
      let tx = gx - d * 18, ty = p.y * 0.6;
      if (!inZone) { tx = p.x + d * 30; ty = p.y * 0.7; }
      if (inZone && dist < 26) { tx = gx - d * 12; ty = -Math.sign(p.y || 1) * 6; }   // cut across the slot
      // avoid the nearest defender ahead
      let ax = 0, ay = 0;
      for (const q of this.players) if (q.team !== p.team && q.down <= 0) {
        const qx = q.x - p.x, qy = q.y - p.y, dd = len(qx, qy);
        if (dd < 14 && qx * d > -2) { ax -= qx / dd * (14 - dd) * 1.8; ay -= qy / dd * (14 - dd) * 2.4; }
      }
      ai.tx = tx + ax; ai.ty = clamp(ty + ay, -36, 36);
    }
    this._seek(p, ai.tx, ai.ty, dt, 1);
  }

  // --- flow ------------------------------------------------------------------------------------

  _goal(team) {
    this.score[team]++;
    const sh = this.puck.shot || {};
    if (sh.kind === 'onetimer') this.stats.goalsOneT[team]++;
    const by = this.puck.last;
    this.state = 'goal'; this.stateT = 0;
    this.lastGoal = { team, by: by && by.team === team ? by : null, kind: sh.kind };
    this.msg = { text: 'GOAL!', sub: `${TEAMS[team].abbr} ${by && by.team === team ? '#' + by.num + ' ' + by.name : ''}`, t: 3 };
    for (const p of this.players) { p.hasPuck = false; p.windup = 0; p.oneT = false; }
    this.puck.owner = null; this.puck.shot = null; this.puck.pass = null;
    this.events.push(team === 0 ? 'goalHome' : 'goalAway');
  }

  _stoppage(x, y, why) {
    this.state = 'stop'; this.stateT = 0;
    const dots = [[-69, -22], [-69, 22], [69, -22], [69, 22], [-20, -22], [-20, 22], [20, -22], [20, 22]];
    let best = dots[0], bd = 1e9;
    for (const dd of dots) { const d = len(dd[0] - x, dd[1] - y); if (d < bd) { bd = d; best = dd; } }
    this.stopAt = { x: best[0], y: best[1] };
    this.msg = { text: why, sub: '', t: 1.4 };
    for (const p of this.players) { if (p.hasPuck) p.hasPuck = false; p.windup = 0; }
    this.puck.owner = null; this.puck.shot = null; this.puck.pass = null;
    this.events.push('whistle');
  }

  _periodEnd() {
    this.clock = 0;
    this.events.push('horn');
    if (this.period >= 3 && this.score[0] !== this.score[1]) { this._final(); return; }
    if (this.period >= 4) { this._final(); return; }
    this.period++;
    this.clock = PERIOD_S;
    this.state = 'intermission'; this.stateT = 0;
    this.msg = { text: this.period === 4 ? 'OVERTIME' : `END OF PERIOD ${this.period - 1}`, sub: `${TEAMS[0].abbr} ${this.score[0]}  ${TEAMS[1].abbr} ${this.score[1]}`, t: 3 };
    for (const p of this.players) { p.hasPuck = false; p.vx = 0; p.vy = 0; }
    this.puck.owner = null;
  }

  _final() {
    this.state = 'final'; this.over = true;
    const [a, b] = this.score;
    this.result = a > b ? 'win' : a < b ? 'loss' : 'tie';
    this.msg = { text: 'FINAL', sub: `${TEAMS[0].abbr} ${a}  ${TEAMS[1].abbr} ${b}`, t: 99 };
    this.events.push('final');
  }

  _faceoff(x, y, title) {
    this.state = 'faceoff'; this.stateT = 0;
    this.fo = { x, y, drop: 1.0 + this.rng() * 0.6, won: null, aiReact: 0.1 + this.rng() * 0.3, humanAt: null, early: false };
    const pk = this.puck;
    pk.x = x; pk.y = y; pk.z = 3; pk.vx = 0; pk.vy = 0; pk.vz = 0; pk.owner = null; pk.shot = null; pk.pass = null; pk.frozen = 0;
    for (const p of this.players) {
      const d = this.dir(p.team);
      let fx, fy;
      if (p.goalie) { fx = this.netX(p.team) + d * 1.5; fy = 0; }
      else if (p.role === 'C') { fx = x - d * 2.2; fy = y; }
      else if (p.role === 'LW') { fx = x - d * 3; fy = y + d * 14; }
      else if (p.role === 'RW') { fx = x - d * 3; fy = y - d * 14; }
      else if (p.role === 'LD') { fx = x - d * 22; fy = y + d * 9; }
      else { fx = x - d * 22; fy = y - d * 9; }
      const h = boardHit(fx, fy, 3);
      if (h) { fx += h.nx * h.pen; fy += h.ny * h.pen; }
      p.x = fx; p.y = fy; p.vx = 0; p.vy = 0; p.face = d > 0 ? 0 : Math.PI; p.down = 0; p.hasPuck = false; p.windup = 0; p.check = 0; p.oneT = false; p.ai.oneT = false;
    }
    if (this.human !== null) this.ctl = this.players[this.human * 6];
    if (title) this.msg = { text: title, sub: '', t: 1.6 };
    this.events.push('faceoffSet');
  }

  _faceoffStep(dt, inp, edge) {
    const fo = this.fo, t = this.stateT;
    for (const p of this.players) if (!p.goalie) this._skate(p, 0, 0, dt, false);
    // pressing before the drop is early: the draw goes to the other centre
    if (this.human !== null && (edge.shoot || edge.pass)) {
      if (t < fo.drop) fo.early = true;
      else if (fo.humanAt === null) fo.humanAt = t - fo.drop;
    }
    if (t < fo.drop) return;
    if (!this._dropped) { this._dropped = true; this.puck.z = 0; this.events.push('drop'); }
    const tt = t - fo.drop;
    let winner = null;
    if (this.human === null) winner = tt > fo.aiReact ? (this.rng() < 0.5 ? 0 : 1) : null;
    else {
      const other = 1 - this.human;
      if (fo.humanAt !== null && !fo.early && fo.humanAt < fo.aiReact) winner = this.human;
      else if (tt > fo.aiReact) winner = fo.early || fo.humanAt === null || fo.humanAt >= fo.aiReact ? other : this.human;
    }
    if (winner === null) return;
    this._dropped = false;
    // the draw goes back to a defenceman
    const c = this.players[winner * 6];
    const dman = this.players[winner * 6 + (this.rng() < 0.5 ? 3 : 4)];
    const pk = this.puck;
    const a = Math.atan2(dman.y - pk.y, dman.x - pk.x);
    const v = 38;
    pk.vx = Math.cos(a) * v; pk.vy = Math.sin(a) * v; pk.pass = { to: dman, from: c, t: 0 };
    pk.last = c; pk.lastTeam = winner;
    c.pickCd = 0.4;
    this.players[(1 - winner) * 6].pickCd = 0.5;      // the centre who lost it can't just take it off the dot
    this.state = 'play'; this.stateT = 0;
    this.events.push('draw');
    if (this.human === winner) this.ctl = dman;
  }
}
