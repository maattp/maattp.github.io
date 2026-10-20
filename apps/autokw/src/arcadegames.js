// SIX CABINETS: faithful recreations of six classic arcade games' rules and
// feel, under generic names, drawn at their original resolutions on a canvas
// (arcade.js scales it into a cabinet's bezel). Original art and code; the
// rules are the classics':
//
//   PADDLE      the 1972 tennis game: paddle angle by where the ball strikes,
//               the rally speeding up, first to 11
//   BRICKS      the 1976 brick-breaker: eight rows in four colours (1/3/5/7),
//               the ball quickening at 4 and 12 hits and on the first orange
//               and red, the paddle halving when the ball reaches the back
//               wall, two walls a game
//   SERPENT     the snake: grow, quicken, don't bite yourself or the wall
//   ROCKS       the 1979 vector rock-shooter: rotate, thrust, fire, hyperspace;
//               rocks split large > medium > small (20/50/100), saucers, the
//               heartbeat quickening as the rocks thin out, a ship at 10,000
//   SPACE RAID  the 1978 marching invaders: 5 x 11 (30/20/10), the march
//               quickening as they fall, erodible bunkers, the mystery ship
//   CROSSING    the 1981 frog: five lanes of traffic and a river of logs and
//               diving turtles to five homes, against the clock (here the
//               traffic is Seattle's and the river is the Ship Canal)
//
// Each game is a class with w/h (logical pixels), score, over, and
// step(dt, input, sfx) / draw(g). `input` holds held directions and buttons
// and one-frame presses (`pressed.a`, `pressed.up`, ...). `sfx(name)` plays a
// sound from arcade.js's Beeper.

import { FONT } from './fishing.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 3x5 pixel text, scaled; align 'left' | 'center' | 'right'. */
export function text(g, s, x, y, scale = 1, col = '#fff', align = 'left') {
  s = String(s).toUpperCase();
  const cw = 4 * scale, W = s.length * cw - scale;
  let x0 = align === 'center' ? Math.round(x - W / 2) : align === 'right' ? x - W : x;
  g.fillStyle = col;
  for (const ch of s) {
    const f = FONT[ch];
    if (f) for (let i = 0; i < 15; i++) if (f[i] === '1') g.fillRect(x0 + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
    x0 += cw;
  }
}

/** Sprites from strings: '#' lit, anything else dark. */
function sprite(rows) { return rows.map((r) => [...r].map((c) => c === '#')); }
function drawSprite(g, sp, x, y, col, s = 1) {
  g.fillStyle = col;
  for (let j = 0; j < sp.length; j++) for (let i = 0; i < sp[j].length; i++) if (sp[j][i]) g.fillRect(x + i * s, y + j * s, s, s);
}

// --- PADDLE ---------------------------------------------------------------------------

export class Paddle {
  constructor() {
    this.name = 'PADDLE'; this.w = 256; this.h = 192;
    this.p = { y: 86 }; this.c = { y: 86 };
    this.ps = 0; this.cs = 0; this.score = 0; this.over = false;
    this._serve(1);
  }
  _serve(dir) {
    this.ball = { x: 126, y: rnd(40, 150), vx: 0, vy: 0 };
    this.serveT = 1.0; this.serveDir = dir; this.rally = 0;
  }
  step(dt, inp, sfx) {
    if (this.over) return;
    const P = 20;       // paddle height
    this.p.y = clamp(this.p.y + ((inp.down ? 1 : 0) - (inp.up ? 1 : 0)) * 190 * dt, 16, this.h - 16 - P);
    const b = this.ball;
    if (this.serveT > 0) {
      this.serveT -= dt;
      if (this.serveT <= 0) {
        const a = rnd(-0.5, 0.5), sp = 150;
        b.vx = Math.cos(a) * sp * this.serveDir; b.vy = Math.sin(a) * sp;
      }
    }
    // The machine: after the ball when it comes its way, misjudging it by an
    // amount picked each return that grows with the rally, and no faster than
    // 175 px/s -- a steep return at a long rally's speed beats it.
    if (this._aimFor !== this.rally) { this._aimFor = this.rally; this._miss = rnd(-1, 1) * (4 + this.rally * 1.6); }
    const toward = b.vx > 0, target = toward ? b.y - P / 2 + this._miss : this.h / 2 - P / 2;
    const cmax = Math.min(175, (toward ? 115 : 60) + this.rally * 5);
    this.c.y = clamp(this.c.y + clamp(target - this.c.y, -cmax * dt, cmax * dt), 16, this.h - 16 - P);
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < 16) { b.y = 16; b.vy = Math.abs(b.vy); sfx('wall'); }
    if (b.y > this.h - 20) { b.y = this.h - 20; b.vy = -Math.abs(b.vy); sfx('wall'); }
    const hit = (px, py, dir) => {
      if (b.y + 4 < py || b.y > py + P) return false;
      const off = clamp((b.y + 2 - (py + P / 2)) / (P / 2), -1, 1);
      const sp = Math.min(330, Math.hypot(b.vx, b.vy) * 1.07);
      const a = off * 1.05;
      b.vx = Math.cos(a) * sp * dir; b.vy = Math.sin(a) * sp;
      b.x = px + (dir > 0 ? 4 : -4);
      this.rally++;
      sfx('paddle');
      return true;
    };
    if (b.vx < 0 && b.x <= 16 && b.x > 8) hit(16, this.p.y, 1);
    if (b.vx > 0 && b.x + 4 >= this.w - 16 && b.x < this.w - 8) hit(this.w - 20, this.c.y, -1);
    if (b.x < -8) { this.cs++; sfx('point'); this._serve(1); }
    if (b.x > this.w + 8) { this.ps++; this.score = this.ps * 100; sfx('point'); this._serve(-1); }
    if (this.ps >= 11 || this.cs >= 11) {
      this.over = true;
      if (this.ps >= 11) this.score += 1000;
      this.result = this.ps >= 11 ? 'YOU WIN' : 'GAME OVER';
    }
  }
  draw(g) {
    g.fillStyle = '#000'; g.fillRect(0, 0, this.w, this.h);
    g.fillStyle = '#fff';
    g.fillRect(0, 8, this.w, 4); g.fillRect(0, this.h - 12, this.w, 4);
    for (let y = 14; y < this.h - 12; y += 12) g.fillRect(this.w / 2 - 2, y, 4, 6);
    text(g, this.ps, this.w / 2 - 28, 18, 5, '#fff', 'center');
    text(g, this.cs, this.w / 2 + 28, 18, 5, '#fff', 'center');
    g.fillStyle = '#fff';
    g.fillRect(12, this.p.y, 4, 20); g.fillRect(this.w - 16, this.c.y, 4, 20);
    if (this.serveT <= 0 || Math.floor(this.serveT * 6) % 2) g.fillRect(this.ball.x, this.ball.y, 4, 4);
  }
}

// --- BRICKS ---------------------------------------------------------------------------

const BRICK_COL = ['#c43a2c', '#c43a2c', '#d88a2a', '#d88a2a', '#3aa04a', '#3aa04a', '#d8c83a', '#d8c83a'];
const BRICK_PTS = [7, 7, 5, 5, 3, 3, 1, 1];

export class Bricks {
  constructor() {
    this.name = 'BRICKS'; this.w = 224; this.h = 256;
    this.score = 0; this.balls = 3; this.over = false; this.wall = 0;
    this.px = 100; this.pw = 24;
    this._fill();
    this._newBall();
  }
  _fill() {
    this.bricks = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 14; c++) this.bricks.push({ r, c, on: true });
    this.hits = 0; this.speedLv = 0; this.orange = false; this.red = false; this.backWall = false;
  }
  _newBall() { this.ball = null; this.serveT = 1.0; }
  _speed() { return [110, 135, 160, 190, 215][this.speedLv]; }
  step(dt, inp, sfx) {
    if (this.over) return;
    this.px = clamp(this.px + ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * 230 * dt, 8, this.w - 8 - this.pw);
    if (!this.ball) {
      this.serveT -= dt;
      if (this.serveT <= 0 && (inp.pressed.a || this.serveT < -2)) {
        const a = rnd(-2.3, -0.84);
        this.ball = { x: rnd(40, 180), y: 120, vx: Math.cos(a) * this._speed(), vy: -Math.sin(a) * this._speed() };
        this.ball.vy = Math.abs(this.ball.vy);
      }
      return;
    }
    const b = this.ball, steps = 3;
    for (let k = 0; k < steps; k++) {
      b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
      if (b.x < 8) { b.x = 8; b.vx = Math.abs(b.vx); sfx('wall'); }
      if (b.x > this.w - 11) { b.x = this.w - 11; b.vx = -Math.abs(b.vx); sfx('wall'); }
      if (b.y < 24) {
        b.y = 24; b.vy = Math.abs(b.vy); sfx('wall');
        if (!this.backWall) { this.backWall = true; this.pw = 12; }
      }
      // bricks: rows of 6 px from y 48, 14 across 208 px
      const bw = 208 / 14;
      const r = Math.floor((b.y + 1 - 48) / 6), c = Math.floor((b.x + 1 - 8) / bw);
      if (r >= 0 && r < 8 && c >= 0 && c < 14) {
        const br = this.bricks[r * 14 + c];
        if (br.on) {
          br.on = false; b.vy = -b.vy;
          this.score += BRICK_PTS[r]; this.hits++;
          sfx(r < 2 ? 'brickHi' : r < 4 ? 'brickMid' : 'brick');
          if (this.hits === 4 || this.hits === 12) this.speedLv = Math.min(4, this.speedLv + 1);
          if (r < 4 && r >= 2 && !this.orange) { this.orange = true; this.speedLv = Math.min(4, this.speedLv + 1); }
          if (r < 2 && !this.red) { this.red = true; this.speedLv = Math.min(4, this.speedLv + 1); }
          const s = this._speed(), cur = Math.hypot(b.vx, b.vy);
          b.vx *= s / cur; b.vy *= s / cur;
          if (this.bricks.every((q) => !q.on)) {
            this.wall++;
            if (this.wall >= 2) { this.over = true; this.result = 'CLEARED!'; return; }
            this._fill(); this.pw = 24; this._newBall(); return;
          }
          break;
        }
      }
      // paddle: the angle by where it strikes
      const py = 232;
      if (b.vy > 0 && b.y + 3 >= py && b.y < py + 4 && b.x + 3 >= this.px && b.x <= this.px + this.pw) {
        const off = clamp((b.x + 1.5 - (this.px + this.pw / 2)) / (this.pw / 2), -1, 1);
        const a = off * 1.05, s = this._speed();
        b.vx = Math.sin(a) * s; b.vy = -Math.cos(a) * s;
        sfx('paddle');
      }
      if (b.y > this.h) {
        this.balls--; sfx('lose');
        if (this.balls <= 0) { this.over = true; this.result = 'GAME OVER'; }
        this._newBall();
        return;
      }
    }
  }
  draw(g) {
    g.fillStyle = '#000'; g.fillRect(0, 0, this.w, this.h);
    g.fillStyle = '#9aa0a8';
    g.fillRect(0, 24, 8, this.h - 24); g.fillRect(this.w - 8, 24, 8, this.h - 24); g.fillRect(0, 16, this.w, 8);
    text(g, String(this.score).padStart(3, '0'), 20, 4, 2, '#fff');
    text(g, this.balls, 120, 4, 2, '#fff');
    text(g, this.wall + 1, 190, 4, 2, '#fff');
    const bw = 208 / 14;
    for (const b of this.bricks) if (b.on) { g.fillStyle = BRICK_COL[b.r]; g.fillRect(8 + b.c * bw + 0.5, 48 + b.r * 6, bw - 1, 5); }
    g.fillStyle = '#3a8ad8'; g.fillRect(this.px, 232, this.pw, 4);
    if (this.ball) { g.fillStyle = '#fff'; g.fillRect(this.ball.x, this.ball.y, 3, 3); }
    else if (this.serveT <= 0) text(g, 'PRESS A', this.w / 2, 150, 2, '#fff', 'center');
  }
}

// --- SERPENT --------------------------------------------------------------------------

export class Serpent {
  constructor() {
    this.name = 'SERPENT'; this.w = 256; this.h = 192;
    this.cols = 32; this.rows = 22;
    this.snake = [[8, 11], [7, 11], [6, 11], [5, 11]];
    this.dir = [1, 0]; this.want = [1, 0];
    this.t = 0; this.score = 0; this.over = false; this.grow = 0;
    this._apple();
  }
  _apple() {
    for (;;) {
      const a = [Math.floor(rnd(0, this.cols)), Math.floor(rnd(0, this.rows))];
      if (!this.snake.some(([x, y]) => x === a[0] && y === a[1])) { this.apple = a; return; }
    }
  }
  step(dt, inp, sfx) {
    if (this.over) return;
    const d = this.dir;
    if (inp.left && d[0] === 0) this.want = [-1, 0];
    else if (inp.right && d[0] === 0) this.want = [1, 0];
    else if (inp.up && d[1] === 0) this.want = [0, -1];
    else if (inp.down && d[1] === 0) this.want = [0, 1];
    this.t += dt;
    const every = Math.max(0.05, 0.12 - this.snake.length * 0.0015);
    while (this.t >= every) {
      this.t -= every;
      this.dir = this.want;
      const [hx, hy] = this.snake[0], nx = hx + this.dir[0], ny = hy + this.dir[1];
      if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows || this.snake.some(([x, y], i) => i < this.snake.length - (this.grow ? 0 : 1) && x === nx && y === ny)) {
        this.over = true; this.result = 'GAME OVER'; sfx('lose'); return;
      }
      this.snake.unshift([nx, ny]);
      if (nx === this.apple[0] && ny === this.apple[1]) {
        this.score += 10 + Math.floor(this.snake.length / 5) * 5; this.grow += 3; this._apple(); sfx('eat');
      }
      if (this.grow > 0) this.grow--; else this.snake.pop();
      sfx('tick');
    }
  }
  draw(g) {
    g.fillStyle = '#0c1a10'; g.fillRect(0, 0, this.w, this.h);
    g.fillStyle = '#16301e'; g.fillRect(0, 16, this.w, this.h - 16);
    text(g, `SCORE ${this.score}`, 4, 5, 1, '#9fe6a8');
    text(g, `LENGTH ${this.snake.length}`, this.w - 4, 5, 1, '#9fe6a8', 'right');
    const c = 8, oy = 16;
    g.fillStyle = '#ff5a4a'; g.fillRect(this.apple[0] * c + 1, oy + this.apple[1] * c + 1, 6, 6);
    g.fillStyle = '#3a8a2a'; g.fillRect(this.apple[0] * c + 3, oy + this.apple[1] * c, 2, 2);
    this.snake.forEach(([x, y], i) => {
      g.fillStyle = i === 0 ? '#c8ff7a' : i % 2 ? '#6fd84a' : '#5ac43c';
      g.fillRect(x * c + 1, oy + y * c + 1, 7, 7);
    });
  }
}

// --- ROCKS (vector) ----------------------------------------------------------------------

export class Rocks {
  constructor() {
    this.name = 'ROCKS'; this.w = 320; this.h = 240; this.vector = true;
    this.score = 0; this.lives = 3; this.over = false; this.extra = 10000;
    this.ship = { x: 160, y: 120, a: -Math.PI / 2, vx: 0, vy: 0, dead: 0, inv: 2 };
    this.bullets = []; this.rocks = []; this.wave = 0; this.bits = [];
    this.saucer = null; this.saucerT = 18; this.sb = [];
    this.beat = 0; this.beatT = 1; this.beatHi = false;
    this._wave();
  }
  _rock(x, y, size) {
    const r = [20, 11, 5.5][size], n = 11, shape = [];
    for (let i = 0; i < n; i++) shape.push(r * rnd(0.72, 1.12));
    const a = rnd(0, Math.PI * 2), sp = rnd(22, 52) * (1 + size * 0.45) * (1 + this.wave * 0.05);
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, size, shape, rot: 0, spin: rnd(-1, 1) };
  }
  _wave() {
    this.wave++;
    const n = Math.min(10, 3 + this.wave);
    for (let i = 0; i < n; i++) {
      const edge = Math.random() < 0.5;
      this.rocks.push(this._rock(edge ? 0 : rnd(0, this.w), edge ? rnd(0, this.h) : 0, 0));
    }
  }
  _wrap(o) { o.x = (o.x + this.w) % this.w; o.y = (o.y + this.h) % this.h; }
  _burst(x, y, n) { for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(20, 90); this.bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rnd(0.4, 0.9) }); } }
  _addScore(p) {
    this.score += p;
    if (this.score >= this.extra) { this.lives++; this.extra += 10000; }
  }
  step(dt, inp, sfx) {
    if (this.over) return;
    const s = this.ship;
    // the heartbeat, quickening as the rocks thin out
    this.beatT -= dt;
    if (this.beatT <= 0 && !s.dead) { this.beatT = clamp(0.25 + this.rocks.length * 0.07, 0.25, 1); this.beatHi = !this.beatHi; sfx(this.beatHi ? 'beatHi' : 'beatLo'); }
    if (s.dead > 0) {
      s.dead -= dt;
      if (s.dead <= 0) {
        if (this.lives <= 0) { this.over = true; this.result = 'GAME OVER'; return; }
        Object.assign(s, { x: 160, y: 120, vx: 0, vy: 0, a: -Math.PI / 2, dead: 0, inv: 2.5 });
      }
    } else {
      s.inv = Math.max(0, s.inv - dt);
      s.a += ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * 4.4 * dt;
      s.thrust = inp.up || inp.b;
      if (s.thrust) { s.vx += Math.cos(s.a) * 190 * dt; s.vy += Math.sin(s.a) * 190 * dt; if (Math.random() < 0.3) sfx('thrust'); }
      const sp = Math.hypot(s.vx, s.vy), max = 230;
      if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
      s.vx *= Math.exp(-0.45 * dt); s.vy *= Math.exp(-0.45 * dt);
      s.x += s.vx * dt; s.y += s.vy * dt; this._wrap(s);
      if (inp.pressed.a && this.bullets.length < 4) {
        this.bullets.push({ x: s.x + Math.cos(s.a) * 8, y: s.y + Math.sin(s.a) * 8, vx: s.vx + Math.cos(s.a) * 300, vy: s.vy + Math.sin(s.a) * 300, t: 0.85 });
        sfx('fire');
      }
      if (inp.pressed.down) {
        // hyperspace: somewhere else, and sometimes not in one piece
        s.x = rnd(20, 300); s.y = rnd(20, 220); s.vx = s.vy = 0;
        sfx('hyper');
        if (Math.random() < 0.12) this._kill(sfx);
      }
    }
    for (const b of this.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.t -= dt; this._wrap(b); }
    this.bullets = this.bullets.filter((b) => b.t > 0);
    for (const r of this.rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt; this._wrap(r); }
    for (const p of this.bits) { p.x += p.vx * dt; p.y += p.vy * dt; p.t -= dt; }
    this.bits = this.bits.filter((p) => p.t > 0);
    // the saucer: big and wild, or (past 10,000) small and aimed
    this.saucerT -= dt;
    if (!this.saucer && this.saucerT <= 0) {
      const small = this.score > 10000 && Math.random() < 0.6, dir = Math.random() < 0.5 ? 1 : -1;
      this.saucer = { x: dir > 0 ? -10 : this.w + 10, y: rnd(30, 210), vx: dir * (small ? 70 : 50), small, fireT: 1, turn: 1.5, r: small ? 5 : 10 };
      this.saucerT = rnd(14, 24);
    }
    if (this.saucer) {
      const u = this.saucer;
      u.x += u.vx * dt;
      u.turn -= dt; if (u.turn <= 0) { u.turn = rnd(1, 2); u.vy = rnd(-40, 40); }
      u.y = clamp(u.y + (u.vy || 0) * dt, 20, 220);
      u.fireT -= dt;
      if (u.fireT <= 0 && !s.dead) {
        u.fireT = u.small ? 0.9 : 1.4;
        const a = u.small ? Math.atan2(s.y - u.y, s.x - u.x) + rnd(-0.12, 0.12) : rnd(0, 6.28);
        this.sb.push({ x: u.x, y: u.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, t: 1.3 });
        sfx('saucerFire');
      }
      if (Math.random() < dt * 6) sfx(u.small ? 'saucerHi' : 'saucerLo');
      if (u.x < -20 || u.x > this.w + 20) this.saucer = null;
    }
    for (const b of this.sb) { b.x += b.vx * dt; b.y += b.vy * dt; b.t -= dt; this._wrap(b); }
    this.sb = this.sb.filter((b) => b.t > 0);
    // hits
    const split = (r, i) => {
      this.rocks.splice(i, 1);
      this._addScore([20, 50, 100][r.size]);
      this._burst(r.x, r.y, 6 + (2 - r.size) * 3);
      sfx(r.size === 0 ? 'bangL' : r.size === 1 ? 'bangM' : 'bangS');
      if (r.size < 2) for (let k = 0; k < 2; k++) this.rocks.push(this._rock(r.x, r.y, r.size + 1));
    };
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi];
      for (let i = this.rocks.length - 1; i >= 0; i--) {
        const r = this.rocks[i];
        if ((b.x - r.x) ** 2 + (b.y - r.y) ** 2 < r.r * r.r) { this.bullets.splice(bi, 1); split(r, i); break; }
      }
      if (this.saucer && this.bullets[bi] === b && (b.x - this.saucer.x) ** 2 + (b.y - this.saucer.y) ** 2 < (this.saucer.r + 2) ** 2) {
        this._addScore(this.saucer.small ? 1000 : 200); this._burst(this.saucer.x, this.saucer.y, 14); this.saucer = null;
        this.bullets.splice(bi, 1); sfx('bangM');
      }
    }
    if (!s.dead && s.inv <= 0) {
      for (let i = this.rocks.length - 1; i >= 0; i--) {
        const r = this.rocks[i];
        if ((s.x - r.x) ** 2 + (s.y - r.y) ** 2 < (r.r + 5) ** 2) { split(r, i); this._kill(sfx); break; }
      }
      for (const b of this.sb) if (!s.dead && (b.x - s.x) ** 2 + (b.y - s.y) ** 2 < 36) { b.t = 0; this._kill(sfx); }
      if (this.saucer && !s.dead && (this.saucer.x - s.x) ** 2 + (this.saucer.y - s.y) ** 2 < (this.saucer.r + 5) ** 2) { this._burst(this.saucer.x, this.saucer.y, 12); this.saucer = null; this._kill(sfx); }
    }
    if (!this.rocks.length) this._wave();
  }
  _kill(sfx) {
    const s = this.ship;
    this._burst(s.x, s.y, 18);
    s.dead = 2.2; this.lives--; sfx('bangL');
  }
  draw(g) {
    g.fillStyle = '#000'; g.fillRect(0, 0, this.w, this.h);
    g.strokeStyle = '#e8f4ff'; g.lineWidth = 1.2; g.shadowColor = '#bfe0ff'; g.shadowBlur = 6; g.lineJoin = 'round';
    for (const r of this.rocks) {
      g.beginPath();
      r.shape.forEach((rr, i) => { const a = (i / r.shape.length) * 6.283 + r.rot; const x = r.x + Math.cos(a) * rr, y = r.y + Math.sin(a) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath(); g.stroke();
    }
    const s = this.ship;
    if (!s.dead && !(s.inv > 0 && Math.floor(s.inv * 10) % 2)) {
      const P = (a, d) => [s.x + Math.cos(s.a + a) * d, s.y + Math.sin(s.a + a) * d];
      g.beginPath(); g.moveTo(...P(0, 9)); g.lineTo(...P(2.5, 7)); g.lineTo(...P(Math.PI, 3)); g.lineTo(...P(-2.5, 7)); g.closePath(); g.stroke();
      if (s.thrust && Math.random() < 0.7) { g.beginPath(); g.moveTo(...P(2.8, 5)); g.lineTo(...P(Math.PI, 10)); g.lineTo(...P(-2.8, 5)); g.stroke(); }
    }
    if (this.saucer) {
      const u = this.saucer, k = u.r / 10;
      g.beginPath();
      g.moveTo(u.x - 10 * k, u.y); g.lineTo(u.x + 10 * k, u.y); g.lineTo(u.x + 5 * k, u.y + 4 * k); g.lineTo(u.x - 5 * k, u.y + 4 * k); g.closePath();
      g.moveTo(u.x - 10 * k, u.y); g.lineTo(u.x - 5 * k, u.y - 3 * k); g.lineTo(u.x + 5 * k, u.y - 3 * k); g.lineTo(u.x + 10 * k, u.y);
      g.moveTo(u.x - 3 * k, u.y - 3 * k); g.lineTo(u.x - 2 * k, u.y - 6 * k); g.lineTo(u.x + 2 * k, u.y - 6 * k); g.lineTo(u.x + 3 * k, u.y - 3 * k);
      g.stroke();
    }
    g.fillStyle = '#fff';
    for (const b of this.bullets) g.fillRect(b.x - 1, b.y - 1, 2, 2);
    for (const b of this.sb) g.fillRect(b.x - 1, b.y - 1, 2, 2);
    for (const p of this.bits) g.fillRect(p.x, p.y, 1.2, 1.2);
    g.shadowBlur = 0;
    text(g, this.score, 40, 8, 2, '#e8f4ff', 'right');
    for (let i = 0; i < this.lives; i++) {
      g.strokeStyle = '#e8f4ff';
      const x = 14 + i * 9, y = 26;
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 3, y + 4); g.lineTo(x, y + 2); g.lineTo(x - 3, y + 4); g.closePath(); g.stroke();
    }
  }
}

// --- SPACE RAID -----------------------------------------------------------------------------

const INV = {
  squid: [sprite(['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#']),
    sprite(['...##...', '..####..', '.######.', '##.##.##', '########', '.#.##.#.', '#......#', '.#....#.'])],
  crab: [sprite(['..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...']),
    sprite(['..#.....#..', '#..#...#..#', '#.#######.#', '###.###.###', '###########', '.#########.', '..#.....#..', '.#.......#.'])],
  octo: [sprite(['....####....', '.##########.', '############', '###..##..###', '############', '...##..##...', '..##.##.##..', '##........##']),
    sprite(['....####....', '.##########.', '############', '###..##..###', '############', '..###..###..', '.##..##..##.', '..##....##..'])],
};
const CANNON = sprite(['......#......', '.....###.....', '.....###.....', '.###########.', '#############', '#############', '#############', '#############']);
const UFO = sprite(['.....######.....', '...##########...', '..############..', '.##.##.##.##.##.', '################', '..###..##..###..', '...#........#...']);
const BUNKER = sprite(['....##############....', '...################...', '..##################..', '.####################.', '######################', '######################', '######################', '######################',
  '######################', '######################', '######################', '######################', '#######........#######', '######..........######', '#####............#####', '#####............#####']);

export class SpaceRaid {
  constructor() {
    this.name = 'SPACE RAID'; this.w = 224; this.h = 256;
    this.score = 0; this.lives = 3; this.over = false; this.round = 0;
    this.px = 104; this.shot = null; this.bombs = []; this.boom = [];
    this.bunkers = [0, 1, 2, 3].map((i) => ({ x: 24 + i * 46, y: 190, bits: BUNKER.map((r) => r.slice()) }));
    this._wave();
  }
  _wave() {
    this.round++;
    this.aliens = [];
    const top = 48 + Math.min(4, this.round - 1) * 8;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 11; c++) {
      this.aliens.push({ r, c, x: 22 + c * 16, y: top + r * 16, kind: r === 0 ? 'squid' : r < 3 ? 'crab' : 'octo', alive: true });
    }
    this.dir = 1; this.stepT = 0; this.frame = 0; this.march = 0;
    this.ufoT = rnd(18, 26); this.ufo = null; this.dead = 0;
  }
  _alive() { return this.aliens.filter((a) => a.alive); }
  _erode(x, y, r) {
    for (const b of this.bunkers) {
      const lx = Math.round(x - b.x), ly = Math.round(y - b.y);
      if (lx < -r || ly < -r || lx > 22 + r || ly > 16 + r) continue;
      let hit = false;
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const X = lx + i, Y = ly + j;
        if (X >= 0 && Y >= 0 && X < 22 && Y < 16 && b.bits[Y][X] && Math.random() < 0.8 - Math.hypot(i, j) * 0.12) { b.bits[Y][X] = false; hit = true; }
      }
      if (hit) return true;
    }
    return false;
  }
  _bunkerHit(x, y) {
    for (const b of this.bunkers) {
      const lx = Math.round(x - b.x), ly = Math.round(y - b.y);
      if (lx >= 0 && ly >= 0 && lx < 22 && ly < 16 && b.bits[ly][lx]) return true;
    }
    return false;
  }
  step(dt, inp, sfx) {
    if (this.over) return;
    if (this.dead > 0) {
      this.dead -= dt;
      if (this.dead <= 0) { if (this.lives <= 0) { this.over = true; this.result = 'GAME OVER'; return; } this.px = 104; this.bombs = []; }
      return;
    }
    this.px = clamp(this.px + ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * 70 * dt, 8, this.w - 21);
    if (inp.pressed.a && !this.shot) { this.shot = { x: this.px + 6, y: 214 }; sfx('shoot'); }
    if (this.shot) {
      this.shot.y -= 300 * dt;
      const s = this.shot;
      if (s.y < 24) this.shot = null;
      else if (this._bunkerHit(s.x, s.y)) { this._erode(s.x, s.y, 2); this.shot = null; }
      else {
        for (const a of this.aliens) {
          if (!a.alive) continue;
          const w = a.kind === 'squid' ? 8 : a.kind === 'crab' ? 11 : 12, ox = (12 - w) / 2;
          if (s.x >= a.x + ox && s.x <= a.x + ox + w && s.y >= a.y && s.y <= a.y + 8) {
            a.alive = false; this.shot = null;
            this.score += a.kind === 'squid' ? 30 : a.kind === 'crab' ? 20 : 10;
            this.boom.push({ x: a.x, y: a.y, t: 0.25 }); sfx('invaderHit');
            break;
          }
        }
        if (this.shot && this.ufo && s.y < this.ufo.y + 7 && s.x > this.ufo.x && s.x < this.ufo.x + 16) {
          const pts = [50, 100, 150, 300][Math.floor(Math.random() * 4)];
          this.score += pts; this.boom.push({ x: this.ufo.x, y: this.ufo.y, t: 0.8, pts }); this.ufo = null; this.shot = null; sfx('ufoHit');
        }
      }
    }
    // the march: the fewer left, the faster, and the famous four notes
    const alive = this._alive();
    if (!alive.length) { this._wave(); return; }
    this.stepT -= dt;
    if (this.stepT <= 0) {
      this.stepT = clamp(0.012 + alive.length * 0.0145, 0.015, 0.8);
      let minX = 1e9, maxX = -1e9;
      for (const a of alive) { minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x + 12); }
      if ((this.dir > 0 && maxX + 2 > this.w - 6) || (this.dir < 0 && minX - 2 < 6)) {
        for (const a of alive) a.y += 8;
        this.dir = -this.dir;
      } else for (const a of alive) a.x += 2 * this.dir;
      this.frame ^= 1;
      sfx('march' + (this.march++ % 4));
      for (const a of alive) { if (a.y + 8 >= 190) this._erode(a.x + 6, a.y + 6, 5); if (a.y + 8 >= 214) { this.lives = 0; this.dead = 1; this.over = true; this.result = 'INVADED'; return; } }
    }
    // bombs from the lowest in a column, up to three at once
    if (this.bombs.length < 3 && Math.random() < dt * (1.2 + this.round * 0.2)) {
      const cols = {};
      for (const a of alive) if (!cols[a.c] || cols[a.c].y < a.y) cols[a.c] = a;
      const list = Object.values(cols);
      const aimed = list.reduce((best, a) => (Math.abs(a.x + 6 - this.px - 6) < Math.abs(best.x + 6 - this.px - 6) ? a : best), list[0]);
      const from = Math.random() < 0.5 ? aimed : list[Math.floor(Math.random() * list.length)];
      this.bombs.push({ x: from.x + 6, y: from.y + 10, t: 0 });
    }
    for (const b of this.bombs) {
      b.y += 85 * dt; b.t += dt;
      if (this._bunkerHit(b.x, b.y + 3)) { this._erode(b.x, b.y + 3, 2); b.y = 999; }
      if (b.y > 214 && b.y < 222 && b.x >= this.px && b.x <= this.px + 13) {
        b.y = 999; this.lives--; this.dead = 1.6; this.boom.push({ x: this.px, y: 214, t: 1.4, cannon: true }); sfx('playerHit');
      }
      if (this.shot && Math.abs(this.shot.x - b.x) < 2 && Math.abs(this.shot.y - b.y) < 4) { b.y = 999; this.shot = null; }
    }
    this.bombs = this.bombs.filter((b) => b.y < 240);
    // the mystery ship
    this.ufoT -= dt;
    if (!this.ufo && this.ufoT <= 0 && alive.length > 7) { const d = Math.random() < 0.5 ? 1 : -1; this.ufo = { x: d > 0 ? -16 : this.w, y: 34, vx: d * 45 }; this.ufoT = rnd(20, 30); }
    if (this.ufo) { this.ufo.x += this.ufo.vx * dt; if (Math.random() < dt * 10) sfx('ufo'); if (this.ufo.x < -20 || this.ufo.x > this.w + 4) this.ufo = null; }
    for (const e of this.boom) e.t -= dt;
    this.boom = this.boom.filter((e) => e.t > 0);
  }
  draw(g) {
    g.fillStyle = '#000'; g.fillRect(0, 0, this.w, this.h);
    text(g, 'SCORE', 8, 4, 1, '#fff'); text(g, String(this.score).padStart(4, '0'), 8, 12, 2, '#fff');
    text(g, `ROUND ${this.round}`, this.w - 8, 4, 1, '#fff', 'right');
    for (const a of this.aliens) if (a.alive) {
      const sp = INV[a.kind][this.frame], ox = Math.round((12 - sp[0].length) / 2);
      drawSprite(g, sp, a.x + ox, a.y, '#fff');
    }
    if (this.ufo) drawSprite(g, UFO, this.ufo.x, this.ufo.y, '#ff3a3a');
    for (const b of this.bunkers) {
      g.fillStyle = '#3aff5a';
      for (let j = 0; j < 16; j++) for (let i = 0; i < 22; i++) if (b.bits[j][i]) g.fillRect(b.x + i, b.y + j, 1, 1);
    }
    if (!this.dead || Math.floor(this.dead * 8) % 2) drawSprite(g, CANNON, this.px, 214, '#3aff5a');
    g.fillStyle = '#fff';
    if (this.shot) g.fillRect(this.shot.x, this.shot.y, 1, 4);
    for (const b of this.bombs) { const k = Math.floor(b.t * 12) % 2; g.fillRect(b.x + (k ? 1 : -1), b.y, 1, 2); g.fillRect(b.x + (k ? -1 : 1), b.y + 2, 1, 2); g.fillRect(b.x, b.y + 4, 1, 2); }
    for (const e of this.boom) {
      if (e.pts) { text(g, e.pts, e.x + 8, e.y, 1, '#ff3a3a', 'center'); continue; }
      g.fillStyle = e.cannon ? '#3aff5a' : '#fff';
      for (let k = 0; k < 10; k++) g.fillRect(e.x + 6 + rnd(-6, 6), e.y + 4 + rnd(-4, 4), 1, 1);
    }
    g.fillStyle = '#3aff5a'; g.fillRect(0, 236, this.w, 1);
    text(g, this.lives, 8, 241, 1, '#fff');
    for (let i = 0; i < this.lives - 1; i++) drawSprite(g, CANNON, 20 + i * 16, 240, '#3aff5a');
  }
}

// --- CROSSING --------------------------------------------------------------------------------

const FROG = sprite(['..#....#..', '.##.##.##.', '..######..', '.########.', '#.######.#', '#.######.#', '..######..', '.##....##.', '##......##']);

export class Crossing {
  constructor() {
    this.name = 'CROSSING'; this.w = 224; this.h = 256;
    this.score = 0; this.lives = 3; this.over = false; this.level = 1;
    this.homes = [false, false, false, false, false];
    this._lanes();
    this._frog();
  }
  _lanes() {
    const k = 1 + (this.level - 1) * 0.18;
    // rows are 16 px; row 15 the kerb, 10-14 the road, 9 the median, 4-8 the canal, 3 the homes
    this.lanes = [
      { row: 14, dir: -1, speed: 26 * k, kind: 'car', len: 1, gap: [56, 90], col: '#e8d24a' },
      { row: 13, dir: 1, speed: 32 * k, kind: 'car', len: 1, gap: [48, 80], col: '#c8c8d0' },
      { row: 12, dir: -1, speed: 40 * k, kind: 'bus', len: 3, gap: [90, 130], col: '#2a6ad8' },   // a Metro bus
      { row: 11, dir: 1, speed: 58 * k, kind: 'car', len: 1, gap: [70, 120], col: '#e8543a' },
      { row: 10, dir: -1, speed: 30 * k, kind: 'truck', len: 2, gap: [80, 110], col: '#f0f0e8' },
      { row: 8, dir: -1, speed: 28 * k, kind: 'turtle', len: 3, gap: [40, 64] },
      { row: 7, dir: 1, speed: 24 * k, kind: 'log', len: 3, gap: [40, 70] },
      { row: 6, dir: 1, speed: 44 * k, kind: 'log', len: 6, gap: [70, 100] },
      { row: 5, dir: -1, speed: 30 * k, kind: 'turtle', len: 2, gap: [44, 64] },
      { row: 4, dir: 1, speed: 34 * k, kind: 'log', len: 4, gap: [50, 80] },
    ];
    for (const L of this.lanes) {
      L.objs = [];
      let x = rnd(0, 40);
      while (x < this.w + 60) { L.objs.push({ x, dive: rnd(0, 6) }); x += L.len * 16 + rnd(L.gap[0], L.gap[1]); }
      L.span = x;
    }
  }
  _frog() { this.frog = { col: 7, row: 15, x: 7 * 16, hop: 0, face: 0, from: null }; this.maxRow = 15; this.time = 30; this.deadT = 0; }
  _die(sfx, why) { if (this.deadT > 0) return; this.deadT = 1.2; this.lives--; this.why = why; sfx('squash'); }
  step(dt, inp, sfx) {
    if (this.over) return;
    for (const L of this.lanes) {
      for (const o of L.objs) {
        o.x += L.dir * L.speed * dt; o.dive += dt;
        if (L.dir > 0 && o.x > this.w + 20) o.x -= L.span;
        if (L.dir < 0 && o.x + L.len * 16 < -20) o.x += L.span;
      }
    }
    const f = this.frog;
    if (this.deadT > 0) {
      this.deadT -= dt;
      if (this.deadT <= 0) { if (this.lives <= 0) { this.over = true; this.result = 'GAME OVER'; return; } this._frog(); }
      return;
    }
    this.time -= dt;
    if (this.time <= 0) { this._die(sfx, 'TIME'); return; }
    // hop: one cell per press, a short jump between
    if (f.hop > 0) { f.hop -= dt; if (f.hop <= 0) this._landed(sfx); }
    else {
      let dc = 0, dr = 0;
      if (inp.pressed.up) { dr = -1; f.face = 0; } else if (inp.pressed.down) { dr = 1; f.face = 2; }
      else if (inp.pressed.left) { dc = -1; f.face = 3; } else if (inp.pressed.right) { dc = 1; f.face = 1; }
      if (dc || dr) {
        const nr = clamp(f.row + dr, 3, 15), nx = clamp(f.x + dc * 16, 0, this.w - 16);
        f.from = { x: f.x, row: f.row }; f.row = nr; f.x = nx; f.hop = 0.1; sfx('hop');
      }
    }
    // riding the canal
    const lane = this.lanes.find((L) => L.row === f.row);
    if (lane && (lane.kind === 'log' || lane.kind === 'turtle') && f.hop <= 0) {
      f.x += lane.dir * lane.speed * dt;
      if (f.x < -8 || f.x > this.w - 8) this._die(sfx, 'SWEPT');
    }
    if (f.hop <= 0) this._check(sfx);
  }
  _onObj(L, x) {
    for (const o of L.objs) {
      if (L.kind === 'turtle' && this._diving(o)) continue;
      if (x + 12 > o.x && x + 4 < o.x + L.len * 16) return true;
    }
    return false;
  }
  _diving(o) { const t = o.dive % 7; return t > 5.2 && t < 6.6; }
  _check(sfx) {
    const f = this.frog, L = this.lanes.find((q) => q.row === f.row);
    if (!L) return;
    const on = this._onObj(L, f.x);
    if ((L.kind === 'car' || L.kind === 'bus' || L.kind === 'truck') && on) this._die(sfx, 'SPLAT');
    if ((L.kind === 'log' || L.kind === 'turtle') && !on) this._die(sfx, 'SPLASH');
  }
  _landed(sfx) {
    const f = this.frog;
    if (f.row < this.maxRow) { this.maxRow = f.row; this.score += 10; }
    if (f.row === 3) {
      // a home bay: five of them at x 8, 56, 104, 152, 200 (16 wide)
      const i = [8, 56, 104, 152, 200].findIndex((hx) => Math.abs(f.x - hx) < 9);
      if (i < 0 || this.homes[i]) { this._die(sfx, 'MISSED'); return; }
      this.homes[i] = true;
      this.score += 50 + Math.floor(this.time) * 10;
      sfx('home');
      if (this.homes.every(Boolean)) { this.score += 1000; this.level++; this.homes = [false, false, false, false, false]; this._lanes(); sfx('level'); }
      this._frog();
      return;
    }
    this._check(sfx);
  }
  draw(g) {
    const R = (row) => row * 16;
    g.fillStyle = '#000'; g.fillRect(0, 0, this.w, this.h);
    // the canal, the homes' bank, the median, the road, the kerb
    g.fillStyle = '#10204a'; g.fillRect(0, R(4), this.w, 16 * 5);
    g.fillStyle = '#1a5a2a'; g.fillRect(0, R(3), this.w, 16);
    g.fillStyle = '#10204a';
    for (const hx of [8, 56, 104, 152, 200]) g.fillRect(hx - 2, R(3) + 2, 20, 14);
    g.fillStyle = '#6a3a8a'; g.fillRect(0, R(9), this.w, 16); g.fillRect(0, R(15), this.w, 16);
    g.fillStyle = '#181818'; g.fillRect(0, R(10), this.w, 16 * 5);
    g.fillStyle = '#c8c860';
    for (let r = 11; r <= 14; r++) for (let x = 0; x < this.w; x += 24) g.fillRect(x, R(r) - 1, 12, 1);
    text(g, 'SHIP CANAL', this.w / 2, R(9) + 6, 1, '#d8c8f0', 'center');
    for (const L of this.lanes) {
      for (const o of L.objs) {
        const x = Math.round(o.x), y = R(L.row);
        if (L.kind === 'log') { g.fillStyle = '#8a5a2a'; g.fillRect(x, y + 3, L.len * 16, 10); g.fillStyle = '#6a4220'; for (let k = 0; k < L.len; k++) g.fillRect(x + k * 16 + 6, y + 6, 4, 4); }
        else if (L.kind === 'turtle') {
          const dv = this._diving(o);
          for (let k = 0; k < L.len; k++) { g.fillStyle = dv ? '#1a3a5a' : '#2a8a4a'; g.fillRect(x + k * 16 + 2, y + 3, 12, 10); g.fillStyle = dv ? '#10204a' : '#c84a2a'; g.fillRect(x + k * 16 + 5, y + 6, 6, 4); }
        } else if (L.kind === 'bus') {
          g.fillStyle = L.col; g.fillRect(x, y + 2, 48, 12); g.fillStyle = '#e8c83a'; g.fillRect(x, y + 10, 48, 3);
          g.fillStyle = '#a8d8f8'; for (let k = 0; k < 5; k++) g.fillRect(x + 4 + k * 9, y + 4, 6, 4);
        } else if (L.kind === 'truck') {
          g.fillStyle = L.col; g.fillRect(x + (L.dir < 0 ? 8 : 0), y + 2, 24, 12); g.fillStyle = '#c83a2a'; g.fillRect(x + (L.dir < 0 ? 0 : 24), y + 4, 8, 10);
        } else {
          g.fillStyle = L.col; g.fillRect(x + 1, y + 3, 14, 10); g.fillStyle = '#222'; g.fillRect(x + 2, y + 2, 3, 12); g.fillRect(x + 11, y + 2, 3, 12);
          g.fillStyle = '#a8d8f8'; g.fillRect(x + (L.dir > 0 ? 9 : 4), y + 5, 3, 6);
        }
      }
    }
    // frogs at home
    this.homes.forEach((h, i) => { if (h) drawSprite(g, FROG, [8, 56, 104, 152, 200][i] + 3, R(3) + 4, '#6aff5a'); });
    const f = this.frog;
    if (this.deadT > 0) text(g, this.why || '', f.x + 8, R(f.row) + 4, 1, '#ff5a4a', 'center');
    else {
      const t = f.hop > 0 ? 1 - f.hop / 0.1 : 1, fy = f.from && f.hop > 0 ? R(f.from.row) + (R(f.row) - R(f.from.row)) * t : R(f.row);
      drawSprite(g, FROG, f.x + 3, fy + 3 - (f.hop > 0 ? 3 : 0), '#6aff5a');
    }
    text(g, `SCORE ${this.score}`, 4, 4, 1, '#fff');
    text(g, `LEVEL ${this.level}`, this.w - 4, 4, 1, '#fff', 'right');
    // lives and the clock in the band over the homes, clear of the start kerb
    for (let i = 0; i < this.lives; i++) drawSprite(g, FROG, 4 + i * 12, 18, '#6aff5a');
    g.fillStyle = this.time < 8 ? '#ff5a4a' : '#6aff5a';
    g.fillRect(this.w - 4 - this.time * 3, 22, this.time * 3, 6);
    text(g, 'TIME', this.w - 98, 22, 1, this.time < 8 ? '#ff5a4a' : '#fff', 'right');
  }
}

export const GAMES = [
  { id: 'paddle', title: 'PADDLE', year: '1972', make: () => new Paddle(), color: '#ffffff', help: 'UP / DOWN · first to 11' },
  { id: 'bricks', title: 'BRICKS', year: '1976', make: () => new Bricks(), color: '#ff7a3a', help: 'LEFT / RIGHT · A serves' },
  { id: 'serpent', title: 'SERPENT', year: '1976', make: () => new Serpent(), color: '#7aff5a', help: 'STEER · eat, grow, survive' },
  { id: 'rocks', title: 'ROCKS', year: '1979', make: () => new Rocks(), color: '#bfe0ff', help: 'TURN · UP/B thrust · A fire · DOWN hyperspace' },
  { id: 'raid', title: 'SPACE RAID', year: '1978', make: () => new SpaceRaid(), color: '#3aff5a', help: 'LEFT / RIGHT · A fire' },
  { id: 'crossing', title: 'CROSSING', year: '1981', make: () => new Crossing(), color: '#6aff5a', help: 'HOP · five homes across the canal' },
];
