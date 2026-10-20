// PICKLEBALL, the game itself: no DOM, so Node can play it (pickleball.js
// draws it and hands it the input).
//
// Pickleball was invented on Bainbridge Island in 1965 (Joel Pritchard, Bill
// Bell and Barney McCallum, at Pritchard's house), which is where the court
// in the game stands. Singles, to the USA Pickleball rules that shape it:
//
//   court     20 x 44 ft (6.10 x 13.41 m); the non-volley zone, "the
//             kitchen", 7 ft (2.13 m) either side of the net; net 34 in
//             (0.86 m) at the centre
//   serve     underhand, from behind the baseline, diagonally cross-court,
//             clearing the kitchen: from the right-hand court on an even
//             score, the left on an odd one
//   two-bounce rule   the return of serve must bounce, and so must the
//             return of the return: nobody volleys until each side has let
//             the ball bounce once
//   kitchen   no volleying while standing in it
//   scoring   rally scoring to 11, win by 2 (the scoring the pro leagues
//             took up; every rally is a point)
//
// Metres, seconds. x across (the court's +x is the player's right), y along
// (the player's side is y < 0, the machine's y > 0), h height.

export const COURT = { hw: 3.05, hl: 6.705, kitchen: 2.13, net: 0.86, netEnd: 0.91 };
const G = 9.8, BOUNCE = 0.58, SKID = 0.8, DRAG = 0.12, R = 0.037;
export const REACH = 0.95;        // a paddle's reach from the body's centre

/** Where a ball in flight lands next (first time h reaches 0), by stepping it. */
export function landing(b) {
  let x = b.x, y = b.y, h = b.h, vx = b.vx, vy = b.vy, vh = b.vh;
  for (let i = 0; i < 400; i++) {
    const dt = 1 / 120;
    vx *= 1 - DRAG * dt; vy *= 1 - DRAG * dt;
    vh -= G * dt;
    x += vx * dt; y += vy * dt; h += vh * dt;
    if (h <= R) return { x, y, t: i * dt };
  }
  return { x, y, t: 3 };
}

/** The launch velocity that carries a ball from (x, y, h) to land at (tx, ty) in time T. */
export function aim(x, y, h, tx, ty, T) {
  const k = (1 - Math.exp(-DRAG * T)) / DRAG;     // distance factor under linear drag
  return { vx: (tx - x) / k, vy: (ty - y) / k, vh: (R - h + 0.5 * G * T * T) / T };
}

export class Pickleball {
  /** opts: { rng, level (0..1, the machine's skill) } */
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.level = opts.level === undefined ? 0.55 : opts.level;
    this.score = [0, 0];                 // [you, the machine]
    this.p = [{ x: 0.8, y: -COURT.hl - 0.3, vx: 0, vy: 0, swing: 0 }, { x: -0.8, y: COURT.hl + 0.3, vx: 0, vy: 0, swing: 0 }];
    this.ball = null;
    this.server = 0;                     // who serves the next rally
    this.state = 'serve';                // serve | rally | point | over
    this.t = 0; this.pointT = 0;
    this.events = [];
    this.msg = '';
    this.winner = null;
    this._newRally();
  }

  takeEvents() { const e = this.events; this.events = []; return e; }

  _newRally() {
    const s = this.server, even = this.score[s] % 2 === 0;
    // serve from the right-hand court on an even score: the player's right is
    // +x; the machine faces the other way, so its right is -x
    const sx = (even ? 1 : -1) * (s === 0 ? 1 : -1) * 1.4;
    this.p[s].x = sx; this.p[s].y = (s === 0 ? -1 : 1) * (COURT.hl + 0.25);
    const r = 1 - s;
    this.p[r].x = -sx; this.p[r].y = (r === 0 ? -1 : 1) * (COURT.hl - 0.4);
    this.ball = { x: sx + (s === 0 ? 0.35 : -0.35), y: this.p[s].y, h: 0.9, vx: 0, vy: 0, vh: 0, held: true, bounces: 0, side: s, last: s, hits: 0 };
    this.state = 'serve';
    this.serveSide = sx;
    this.waitT = 0;
  }

  /** Hit the ball from player k: kind 'dink' | 'drive' | 'serve'; aimX in [-1, 1]; quality 0..1 (1 = perfect timing). */
  hit(k, kind, aimX, quality) {
    const b = this.ball, me = this.p[k], dir = k === 0 ? 1 : -1;
    const err = (1 - quality) * (kind === 'drive' ? 1.6 : 1.1);
    const rnd = () => (this.rng() * 2 - 1);
    let tx, ty, T;
    if (kind === 'serve') {
      // diagonally, deep into the box beyond the kitchen
      tx = -this.serveSide * (0.55 + 0.35 * this.rng());
      ty = dir * (COURT.kitchen + 2.6 + this.rng() * 1.2);
      T = 1.15 + this.rng() * 0.15;
    } else if (kind === 'dink') {
      tx = clamp(aimX * 2.4, -2.7, 2.7);
      ty = dir * (0.7 + 1.2 * this.rng());
      T = 0.95 + 0.25 * this.rng();
    } else if (kind === 'lob') {
      tx = clamp(aimX * 2.4, -2.7, 2.7);
      ty = dir * (COURT.hl - 0.9);
      T = 1.7;
    } else {
      tx = clamp(aimX * 2.6, -2.8, 2.8);
      ty = dir * (COURT.hl - 1.0 - 1.8 * this.rng());
      T = Math.max(0.42, Math.hypot(tx - b.x, ty - b.y) / 17);
    }
    tx += rnd() * err * 1.2; ty += rnd() * err * 1.3;
    // a mishit drive sails long or finds the net
    if (kind === 'drive' && quality < 0.35 && this.rng() < 0.5) ty += dir * (this.rng() < 0.5 ? 1.8 : -COURT.hl);
    let v = aim(b.x, b.y, Math.max(b.h, 0.25), tx, ty, T);
    // it has to clear the net: lengthen the flight until it does (a good shot
    // skims it; a mishit may not have the height)
    for (let i = 0; i < 12; i++) {
      const tn = (0 - b.y) / v.vy;
      const hn = b.h + v.vh * tn - 0.5 * G * tn * tn;
      if (tn <= 0 || hn > COURT.net + 0.16 + (quality < 0.3 ? -0.3 : 0)) break;
      T *= 1.12; v = aim(b.x, b.y, Math.max(b.h, 0.25), tx, ty, T);
    }
    Object.assign(b, v, { held: false, bounces: 0, last: k, side: k });
    b.h = Math.max(b.h, 0.25);
    b.hits++;
    me.swing = 0.3;
    this.events.push(kind === 'drive' ? 'drive' : 'pop');
    if (this.state === 'serve') { this.state = 'rally'; this.served = true; }
  }

  /** Can player k hit the ball now (in reach, rules permitting)? Returns null or a reason it may not. */
  reach(k) {
    const b = this.ball, me = this.p[k];
    if (!b || b.held || b.last === k && b.hits > 0) return null;
    const onMySide = k === 0 ? b.y < 0 : b.y > 0;
    if (!onMySide) return null;
    const d = Math.hypot(b.x - me.x, b.y - me.y);
    if (d > REACH || b.h > 2.0) return null;
    return { d, volley: b.bounces === 0 };
  }

  _fault(loser, why) {
    this.score[1 - loser]++;
    this.state = 'point';
    this.pointT = 1.5;
    this.lastLoser = loser;
    this.msg = why;
    this.server = 1 - loser;             // rally scoring: the winner of the rally serves
    this.events.push(loser === 0 ? 'lose' : 'win');
    const [a, c] = this.score;
    if ((a >= 11 || c >= 11) && Math.abs(a - c) >= 2) { this.state = 'over'; this.winner = a > c ? 0 : 1; this.events.push('over'); }
  }

  /** input: { mx, my (move, -1..1), shot: null | 'dink' | 'drive' | 'lob', aimX } for the player. */
  step(dt, input = {}) {
    if (this.state === 'over') return;
    this.t += dt;
    if (this.state === 'point') {
      this.pointT -= dt;
      if (this.pointT <= 0) this._newRally();
      return;
    }
    const b = this.ball;
    // --- you ---
    const P = this.p[0], spd = 4.2;
    P.vx = (input.mx || 0) * spd; P.vy = (input.my || 0) * spd;
    if (this.state === 'serve' && this.server === 0) { P.vx = 0; P.vy = 0; }
    P.x = clamp(P.x + P.vx * dt, -COURT.hw - 1.5, COURT.hw + 1.5);
    P.y = clamp(P.y + P.vy * dt, -COURT.hl - 2.5, -0.35);
    // --- the machine ---
    this._ai(dt);
    for (const q of this.p) q.swing = Math.max(0, q.swing - dt);
    // --- serves ---
    if (this.state === 'serve') {
      b.x = this.p[this.server].x + (this.server === 0 ? 0.35 : -0.35); b.y = this.p[this.server].y;
      if (this.server === 0) { if (input.shot) this.hit(0, 'serve', 0, 0.9); }
      else { this.waitT += dt; if (this.waitT > 1.1) this.hit(1, 'serve', 0, 0.75 + 0.25 * this.level); }
      return;
    }
    // --- your shot ---
    if (input.shot) {
      const r = this.reach(0);
      if (r) this._take(0, input.shot, input.aimX || 0, r);
      else if (!P.swing) { P.swing = 0.25; this.events.push('whiff'); }
    }
    // --- the ball ---
    if (b.held) return;
    const n = 4, h = dt / n;
    for (let i = 0; i < n && this.state === 'rally'; i++) {
      const y0 = b.y;
      b.vx *= 1 - DRAG * h; b.vy *= 1 - DRAG * h;
      b.vh -= G * h;
      b.x += b.vx * h; b.y += b.vy * h; b.h += b.vh * h;
      // the net
      if ((y0 < 0) !== (b.y < 0)) {
        const netH = COURT.net + (COURT.netEnd - COURT.net) * Math.min(1, Math.abs(b.x) / COURT.hw);
        if (b.h < netH && Math.abs(b.x) < COURT.hw + 0.3) { this.events.push('net'); this._fault(b.last, 'INTO THE NET'); return; }
        b.bounces = 0;
      }
      if (b.h <= R && b.vh < 0) {
        const side = b.y < 0 ? 0 : 1;
        // the first bounce: in or out?
        if (b.bounces === 0) {
          const out = Math.abs(b.x) > COURT.hw || Math.abs(b.y) > COURT.hl;
          if (out) { this.events.push('out'); this._fault(b.last, 'OUT'); return; }
          if (side === b.last) { this._fault(b.last, 'INTO THE NET'); return; }
          // a serve must clear the kitchen and land in the diagonal box
          if (b.hits === 1) {
            const inBox = Math.abs(b.y) > COURT.kitchen && Math.sign(b.x) === -Math.sign(this.serveSide);
            if (!inBox) { this.events.push('out'); this._fault(b.last, 'FAULT — SERVE MISSED THE BOX'); return; }
          }
        } else {
          // a second bounce: the side it bounced on loses the rally
          this._fault(side, side === 0 ? 'DOUBLE BOUNCE' : 'WINNER!');
          return;
        }
        b.bounces++;
        b.h = R; b.vh = -b.vh * BOUNCE; b.vx *= SKID; b.vy *= SKID;
        this.events.push('bounce');
      }
    }
    // out of play past the ends without a bounce is caught by the landing test
  }

  _take(k, kind, aimX, r) {
    const b = this.ball, me = this.p[k];
    // the two-bounce rule: the return of serve, and the shot after it, must be played off the bounce
    if (r.volley && b.hits < 3) { this.events.push('fault'); this._fault(k, 'FAULT — LET IT BOUNCE (TWO-BOUNCE RULE)'); return; }
    // the kitchen: no volleying from inside it
    if (r.volley && Math.abs(me.y) < COURT.kitchen) { this.events.push('fault'); this._fault(k, 'KITCHEN FAULT — NO VOLLEYS IN THE KITCHEN'); return; }
    const quality = clamp(1 - r.d / REACH * 0.9, 0, 1);
    this.hit(k, kind, aimX, quality);
  }

  _ai(dt) {
    const C = this.p[1], b = this.ball, L = this.level, spd = 3.4 + 1.0 * L;
    let tx = C.x, ty = C.y;
    if (this.state === 'serve') { tx = C.x; ty = C.y; }
    else if (b && !b.held && b.last === 0) {
      // coming at it: where it will be hittable -- off the bounce if the rules
      // (or the kitchen) say so, else where it crosses reach height
      const land = landing(b);
      const mustBounce = b.hits < 3 || this._inKitchen(1, C.y);
      if (b.bounces === 0 && land.y > 0) {
        const after = { x: land.x + b.vx * 0.3, y: land.y + b.vy * 0.28 };
        const volleyAt = { x: b.x + b.vx * 0.35, y: b.y + b.vy * 0.35 };
        const t = mustBounce || this.rng() < 0.4 ? after : volleyAt;
        tx = t.x; ty = Math.max(0.5, t.y + 0.25);
      } else if (b.bounces > 0) { tx = b.x; ty = b.y + 0.3; }
      // hit it when it is in reach, with the machine's reaction
      // it swings when the ball is in the sweet spot, or about to pass it
      const r = this.reach(1);
      const passing = r && ((b.x - C.x) * b.vx + (b.y - C.y) * b.vy) > 0;
      if (r && (!r.volley || !mustBounce) && (r.d < 0.5 || passing)) {
        this.aiT = (this.aiT || 0) + dt;
        if (this.aiT > 0.12 - 0.08 * L) {
          this.aiT = 0;
          const P = this.p[0];
          const kind = Math.abs(P.y) < 3.2 && b.h < 0.9 ? (this.rng() < 0.7 ? 'dink' : 'drive') : P.y < -COURT.hl + 1 && this.rng() < 0.4 ? 'dink' : this.rng() < 0.12 ? 'lob' : 'drive';
          // away from you
          const aimX = clamp(-Math.sign(P.x || 1) * (0.5 + 0.4 * this.rng()), -1, 1);
          const q = clamp(1 - r.d / REACH * 0.9 - (1 - L) * 0.45 * this.rng(), 0.05, 1);
          const kitchenVolley = r.volley && this._inKitchen(1, C.y);
          if (!kitchenVolley) this.hit(1, kind, aimX, q);
        }
      }
    } else if (b && !b.held && b.last === 1) {
      // after its shot: up to the kitchen line once the third shot is past, else home
      tx = C.x * 0.5 + b.x * 0.2;
      ty = b.hits >= 3 ? COURT.kitchen + 0.35 : COURT.hl - 0.4;
    }
    const dx = tx - C.x, dy = ty - C.y, d = Math.hypot(dx, dy);
    if (d > 0.05) { C.x += dx / d * Math.min(d, spd * dt); C.y += dy / d * Math.min(d, spd * dt); }
    C.y = clamp(C.y, 0.35, COURT.hl + 2.5);
  }

  _inKitchen(k, y) { return Math.abs(y) < COURT.kitchen; }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
