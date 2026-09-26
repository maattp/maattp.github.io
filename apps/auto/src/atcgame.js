// FINAL APPROACH: the game in Boeing Field's control tower, after the touch-
// screen classic where you draw each aircraft's path to its runway. No DOM:
// atc.js draws it and hands it the finger, and Node can play it.
//
// The field is a 1000 x 560 world (screen-like: x right, y down) seen from
// above, north up-ish. Aircraft arrive from the edges -- an arrow shows where,
// a moment before -- and fly straight until you draw them a path. A path that
// ends in the landing zone of the right runway, heading the right way, lands
// the aircraft when it gets there:
//
//   red jets        the long runway (14R), from its north-west end
//   yellow props    the short runway (14L), from its south-east end
//   blue helicopters the pad, from any direction
//   green seaplanes the Duwamish, from its south (from the 12th landing)
//
// Aircraft never leave: at the edge they turn back in. Two airborne aircraft
// closer than their radii collide and the shift is over; closer than twice
// that, both show a warning ring. Arrivals come faster as the count goes up.

// The world is 1000 wide and as tall as the screen's aspect makes it (460-700;
// the layout lives in y 20..460), so the edge the aircraft turn back at is
// the edge of the screen. WH is the default.
export const WW = 1000, WH = 560;

const RAD = Math.PI / 180;
// runways: centre, heading of the landing roll (radians, screen), length, width
export const RUNWAYS = {
  red: { x: 520, y: 290, a: -18 * RAD, len: 400, w: 30, name: '14R', col: '#e8453a' },
  yellow: { x: 610, y: 410, a: 162 * RAD, len: 250, w: 22, name: '14L', col: '#f2c230' },
};
export const PAD = { x: 250, y: 140, r: 26, col: '#3a8ae8' };
// the river: a band down the left, landing on it heading north
export const RIVER = { pts: [[150, 600], [138, 470], [120, 360], [112, 250], [128, 130], [170, 20], [200, -40]], w: 46, land: { x: 128, y: 420, a: -96 * RAD }, col: '#3ac878' };

export const KINDS = {
  jet: { speed: 36, r: 15, col: 'red', target: 'red' },
  fastjet: { speed: 50, r: 13, col: 'red', target: 'red' },
  prop: { speed: 25, r: 12, col: 'yellow', target: 'yellow' },
  heli: { speed: 17, r: 13, col: 'blue', target: 'pad' },
  seaplane: { speed: 23, r: 13, col: 'green', target: 'river' },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Where a runway's landing zone is: the threshold at the start of its roll. */
export function zoneOf(target) {
  if (target === 'pad') return { x: PAD.x, y: PAD.y, r: PAD.r, a: null };
  if (target === 'river') return { x: RIVER.land.x, y: RIVER.land.y, r: 26, a: RIVER.land.a };
  const rw = RUNWAYS[target];
  const back = rw.len / 2 - 26;
  return { x: rw.x - Math.cos(rw.a) * back, y: rw.y - Math.sin(rw.a) * back, r: 24, a: rw.a };
}

export class Atc {
  /** opts: { rng, h } */
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.W = WW; this.H = Math.max(460, Math.min(700, opts.h || WH));
    this.planes = [];
    this.landed = 0;
    this.t = 0;
    this.nextSpawn = 1.5;
    this.over = false;
    this.crash = null;
    this.events = [];
    this.id = 0;
    this.warnT = 0;
  }

  takeEvents() { const e = this.events; this.events = []; return e; }

  // --- the finger ---------------------------------------------------------------------------

  /** The aircraft a touch at (x, y) picks up, if any: the nearest airborne one within reach. */
  pick(x, y) {
    let best = null, bd = 44;
    for (const p of this.planes) {
      if (p.landing || p.dead) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Start a fresh path for p. */
  beginPath(p) {
    p.path = [[p.x, p.y]];
    p.land = false;
    p.drawing = true;
    this.events.push('grab');
  }

  /** Extend p's path with the finger at (x, y). Returns true once it is locked onto a landing. */
  extendPath(p, x, y) {
    if (!p.path || p.land || !p.drawing) return p.land;
    x = clamp(x, 4, this.W - 4); y = clamp(y, 4, this.H - 4);
    const last = p.path[p.path.length - 1];
    const d = Math.hypot(x - last[0], y - last[1]);
    if (d < 7) return false;
    // fill long jumps so the path stays even
    const n = Math.ceil(d / 12);
    for (let i = 1; i <= n; i++) {
      const px = last[0] + (x - last[0]) * i / n, py = last[1] + (y - last[1]) * i / n;
      const prev = p.path[p.path.length - 1];
      p.path.push([px, py]);
      if (this._lands(p, prev, [px, py])) {
        p.land = true; p.drawing = false;
        this.events.push('locked');
        return true;
      }
    }
    if (p.path.length > 900) p.path.splice(1, p.path.length - 900);
    return false;
  }

  endPath(p) { p.drawing = false; }

  /** Does a path segment from a to b enter the right landing zone heading the right way? */
  _lands(p, a, b) {
    const z = zoneOf(KINDS[p.kind].target);
    if (Math.hypot(b[0] - z.x, b[1] - z.y) > z.r) return false;
    if (z.a === null) return true;
    const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return Math.abs(wrap(h - z.a)) < 55 * RAD;
  }

  // --- the frame ------------------------------------------------------------------------------

  step(dt) {
    if (this.over) { this.t += dt; return; }
    this.t += dt;
    // arrivals
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this._spawn();
      const gap = Math.max(2.1, 6.2 - this.landed * 0.13);
      this.nextSpawn = gap * (0.8 + this.rng() * 0.4);
    }
    for (const p of this.planes) this._fly(p, dt);
    this.planes = this.planes.filter((p) => !p.dead);
    // separation
    let warn = false;
    const ps = this.planes;
    for (const p of ps) p.warn = false;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (a.landing || b.landing || a.entering || b.entering) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y), rr = KINDS[a.kind].r + KINDS[b.kind].r;
      if (d < rr * 0.82) {
        this.over = true;
        this.crash = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: this.t, a, b };
        this.events.push('crash');
        return;
      }
      if (d < rr * 2.1) { a.warn = true; b.warn = true; warn = true; }
    }
    if (warn) { this.warnT -= dt; if (this.warnT <= 0) { this.warnT = 0.55; this.events.push('warn'); } } else this.warnT = 0;
  }

  _spawn() {
    const n = this.landed;
    const r = this.rng();
    let kind;
    if (n >= 12 && r < 0.18) kind = 'seaplane';
    else if (n >= 8 && r < 0.3) kind = 'fastjet';
    else kind = r < 0.5 ? 'jet' : r < 0.78 ? 'prop' : 'heli';
    if (kind === 'fastjet' && this.rng() < 0.4) kind = 'jet';
    // an edge, not too near a corner, and a heading into the field
    const side = Math.floor(this.rng() * 4);
    const u = 0.12 + this.rng() * 0.76;
    let x, y, a;
    const m = 44;
    const W = this.W, H = this.H;
    if (side === 0) { x = u * W; y = -m; a = Math.PI / 2; }
    else if (side === 1) { x = W + m; y = u * H; a = Math.PI; }
    else if (side === 2) { x = u * W; y = H + m; a = -Math.PI / 2; }
    else { x = -m; y = u * H; a = 0; }
    a += (this.rng() - 0.5) * 0.9;
    // don't arrive on top of someone already coming in there
    for (const p of this.planes) if (Math.hypot(p.x - x, p.y - y) < 90) { x += Math.cos(a + Math.PI / 2) * 120; y += Math.sin(a + Math.PI / 2) * 120; break; }
    this.planes.push({ id: ++this.id, kind, x, y, a, path: null, land: false, drawing: false, landing: null, entering: true, warn: false, dead: false, age: 0, prop: 0 });
    this.events.push('arrive');
  }

  _fly(p, dt) {
    const K = KINDS[p.kind];
    p.age += dt;
    p.prop += dt;
    if (p.landing) { this._roll(p, dt); return; }
    let dist = K.speed * dt;
    if (p.path && p.path.length > 1) {
      // follow the path exactly, consuming it
      while (dist > 0 && p.path.length > 1) {
        const [nx, ny] = p.path[1];
        const dx = nx - p.x, dy = ny - p.y, d = Math.hypot(dx, dy);
        if (d <= dist) {
          p.x = nx; p.y = ny; dist -= d; p.path.shift();
          if (d > 0.01) p.a = Math.atan2(dy, dx);
        } else {
          p.a = this._turn(p.a, Math.atan2(dy, dx), dt * 7);
          p.x += dx / d * dist; p.y += dy / d * dist; dist = 0;
        }
        p.path[0] = [p.x, p.y];
      }
      if (p.path.length <= 1 && !p.drawing) {
        if (p.land) { this._touchdown(p); return; }
        p.path = null;
      }
    }
    if (dist > 0) { p.x += Math.cos(p.a) * dist; p.y += Math.sin(p.a) * dist; }
    // entering: once fully on screen it is in play
    const W = this.W, H = this.H;
    const inside = p.x > K.r && p.x < W - K.r && p.y > K.r && p.y < H - K.r;
    if (p.entering && inside) p.entering = false;
    // the edge: turn back in
    if (!p.entering && !(p.path && p.path.length > 1)) {
      const M = 18;
      let want = null;
      if (p.x < M && Math.cos(p.a) < 0.2) want = 0;
      else if (p.x > W - M && Math.cos(p.a) > -0.2) want = Math.PI;
      if (p.y < M && Math.sin(p.a) < 0.2) want = want === null ? Math.PI / 2 : (want + Math.PI / 2) / 2;
      else if (p.y > H - M && Math.sin(p.a) > -0.2) want = want === null ? -Math.PI / 2 : want === Math.PI ? -3 * Math.PI / 4 : (want - Math.PI / 2) / 2;
      if (want !== null) p.a = this._turn(p.a, want, dt * 2.2);
      p.x = clamp(p.x, 2, W - 2); p.y = clamp(p.y, 2, H - 2);
    }
  }

  _turn(a, b, max) { const d = wrap(b - a); return a + clamp(d, -max, max); }

  _touchdown(p) {
    const tg = KINDS[p.kind].target;
    p.path = null;
    p.landing = { t: 0, target: tg, x0: p.x, y0: p.y };
    if (tg === 'red' || tg === 'yellow') { const rw = RUNWAYS[tg]; p.a = rw.a; }
    this.landed++;
    this.events.push('land');
  }

  _roll(p, dt) {
    const L = p.landing, K = KINDS[p.kind];
    L.t += dt;
    if (L.target === 'pad') {
      // settle onto the pad
      p.x += (PAD.x - p.x) * Math.min(1, dt * 3); p.y += (PAD.y - p.y) * Math.min(1, dt * 3);
      if (L.t > 1.6) p.dead = true;
      return;
    }
    // roll out along the runway (or the river), slowing
    const v = K.speed * Math.max(0.25, 1 - L.t * 0.35);
    p.x += Math.cos(p.a) * v * dt; p.y += Math.sin(p.a) * v * dt;
    if (L.t > 3.2) p.dead = true;
  }
}
