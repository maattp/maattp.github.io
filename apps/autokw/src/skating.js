// Auto KW: SKATING ON WATERLOO PUBLIC SQUARE'S RINK. kwplaces.js draws the
// rink (`rink()`: the symmetric rounded rectangle, 31.4 x 19.8 m, the white
// sheet in its low red-striped curb, one gap toward King St) and makes the ice
// a platform; nothing about its look changes here.
//
// ENTER on the ice laces up. Then the stick is where you want to go and the
// skates take you there the way skates do: each stride pushes along the way
// you face, the body turns slowly (slower the faster you go), and the blades
// carry the speed round with you -- the glide outlives the push by a long way
// (ice friction is ~0.01 g). Let go of the stick and you glide. PUNCH (J /
// Ctrl / B) is a hockey stop: the body swings side-on, the blades scrape and
// throw snow and you stop in a couple of metres. JUMP (Space / X) slowed down
// is a scratch spin: arms in, the free leg up, ~2 turns a second winding
// down (about three turns from a standstill). RUN (Shift / A) is power strides. The curb is the boards: you bounce
// off it. ENTER again takes the skates off.
//
// Ambient skaters: a few of the crowd's own pedestrians (peds.js
// `spawnTrail`, then `p.skate`) skate loops round the rink, counter-clockwise
// as public skating goes, at their own pace and lane, while the camera is
// within RANGE. They take crowd slots (MAX_PEDS), so they cost no draw a
// pedestrian would not; they are given back when you leave. Always on: the
// rink is drawn as ice in every season.

import { rinkData } from './kwplaces.js';
import { BONES as B } from './peds.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const RANGE = 140, LEAVE = 190;     // skaters come within RANGE of the camera, go past LEAVE
const BODY = 0.38;                  // a skater's radius against the curb
const VMAX = 6.2, VSPRINT = 8.8;    // m/s
const MU = 0.11, DRAG = 0.0035;     // the glide: m/s2, and per (m/s)2
const CROUCH = 0.07;                // a skater's knees take the hips down this far

/** A pose on a humanoid's bones (absolute: everything the walk would leave behind). */
function setB(h, bone, x, y, z) { const r = h.bones[bone].rotation; r.x = x; r.y = y; r.z = z; }

/**
 * Skating, on any humanoid (the player's or a pedestrian's). s:
 *   ph    stride phase (rad; a stride a side per pi)
 *   push  0 gliding .. 1 striding hard
 *   stop  0 .. 1 a hockey stop
 *   spin  0 .. 1 a scratch spin
 *   lean  the bank into a turn (rad, + = left)
 */
export function skatePose(h, s) {
  const sp = Math.sin(s.ph), push = s.push, stop = s.stop, spin = s.spin;
  const L = Math.max(0, sp) * push, R = Math.max(0, -sp) * push;      // which leg is pushing out
  const bend = 0.45 + 0.12 * push + 0.2 * stop;
  // the trunk over the knees; a stop sits back into it
  setB(h, B.hips, 0, 0, 0);
  setB(h, B.spine, 0.32 + 0.1 * push - 0.18 * stop - 0.25 * spin, 0.12 * sp * push, 0);
  setB(h, B.chest, 0.06, 0.1 * sp * push, 0);
  setB(h, B.neck, -0.2 + 0.1 * stop, 0, 0);
  setB(h, B.head, -0.18, 0, 0);
  // legs: knees bent; the pushing leg goes out to its side and back, straightening
  const leg = (th, kn, ft, side, out) => {
    setB(h, th, -bend + 0.55 * out, 0, side * (0.06 + 0.42 * out + 0.12 * stop));
    setB(h, kn, bend * 1.75 - 1.1 * out, 0, 0);
    setB(h, ft, -(bend * 0.75) + 0.35 * out, 0, 0);
  };
  if (spin > 0.02) {
    // the scratch spin: on one straight leg, the free one crossed up in front
    setB(h, B.thighL, -0.08, 0, -0.04); setB(h, B.kneeL, 0.12, 0, 0); setB(h, B.footL, -0.05, 0, 0);
    setB(h, B.thighR, -0.75 * spin, 0, 0.12 * spin); setB(h, B.kneeR, 1.1 * spin, 0, 0); setB(h, B.footR, 0.4, 0, 0);
  } else {
    leg(B.thighL, B.kneeL, B.footL, -1, L);
    leg(B.thighR, B.kneeR, B.footR, 1, R);
  }
  // arms: swinging with the strides, out for balance in a glide, in for a spin
  const swing = 0.45 * sp * push;
  const bal = 1 - push * 0.6;
  // (a spin hugs the arms in: upper arms down at the sides, forearms across the chest)
  const armX = (side) => (0.15 + side * swing - 0.35 * stop) * (1 - spin) - 0.25 * spin;
  const armZ = (side) => side * ((0.22 + 0.35 * bal + 0.4 * stop) * (1 - spin) + 0.04 * spin);
  setB(h, B.shoulderL, armX(-1), 0, armZ(-1));
  setB(h, B.shoulderR, armX(1), 0, armZ(1));
  setB(h, B.elbowL, -0.35 - 1.45 * spin, 0.9 * spin, 0);
  setB(h, B.elbowR, -0.35 - 1.45 * spin, -0.9 * spin, 0);
  h.group.rotation.z = clamp(s.lean, -0.38, 0.38);
}

export class Skating {
  /** opts: { scene, city, peds, audio, controls, fx, hud (getter obj), onReward } */
  constructor(opts) {
    this.o = opts;
    this.R = rinkData();
    this.ok = !!(this.R && this.R.y != null);
    this.skaters = [];
    this.me = null;       // your skating state, while you skate
    this.told = false;
    this.best = { spin: 0, kmh: 0 };
    try { Object.assign(this.best, JSON.parse(localStorage.getItem('autokw-skate') || '{}')); } catch (e) { /* private */ }
    this.stats = { laced: 0, spins: 0, stops: 0, bounces: 0, spawned: 0 };
  }

  get skating() { return !!this.me; }

  // --- the rink's shape: (u, v) along its long axis and across it --------------------

  _uv(x, z) {
    const R = this.R, dx = x - R.c[0], dz = z - R.c[1];
    return [dx * R.u[0] + dz * R.u[1], -dx * R.u[1] + dz * R.u[0]];
  }
  _xz(u, v) {
    const R = this.R;
    return [R.c[0] + R.u[0] * u - R.u[1] * v, R.c[1] + R.u[1] * u + R.u[0] * v];
  }
  /** Signed distance to the curb's inside (negative on the ice), and its outward normal in (u, v). */
  _sdf(u, v, inset = 0) {
    const R = this.R, r = R.r;
    const qx = Math.abs(u) - (R.hl - r), qy = Math.abs(v) - (R.hw - r);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), out = Math.hypot(ox, oy);
    const d = out + Math.min(Math.max(qx, qy), 0) - r + inset;
    let nu, nv;
    if (out > 1e-6) { nu = ox / out; nv = oy / out; } else if (qx > qy) { nu = 1; nv = 0; } else { nu = 0; nv = 1; }
    return { d, nu: nu * Math.sign(u || 1), nv: nv * Math.sign(v || 1) };
  }
  /** On the ice (standing on the sheet, inside the curb)? */
  onIce(x, z, y) {
    if (!this.ok) return false;
    const [u, v] = this._uv(x, z);
    return this._sdf(u, v).d < -0.05 && (y === undefined || Math.abs(y - this.R.y) < 0.7);
  }

  places() {
    if (!this.ok) return [];
    return [{ x: this.R.c[0], z: this.R.c[1], kind: 'skate', name: 'Skating at Waterloo Public Square', label: 'Skating', near: false,
      hello: 'Waterloo Public Square\'s rink — walk onto the ice and press ENTER to lace up. PUNCH stops, JUMP spins, RUN for power strides' }];
  }

  // --- you ---------------------------------------------------------------------------

  /** ENTER: lace up on the ice, or take the skates off. */
  tryInteract(pl) {
    if (!this.ok || !pl.onFoot || pl.swimming || pl.sky) return false;
    if (this.me) { this.stop(pl); return true; }
    if (!this.onIce(pl.x, pl.z, pl.y)) return false;
    this.me = { vx: 0, vz: 0, ph: 0, push: 0, stop: 0, spin: 0, spinT: 0, spinA: 0, spinW: 0, lean: 0, hd: pl.heading, tStop: 0, vTop: 0, scrapeT: 0, bump: 0 };
    pl.skate = this;
    pl.speed = 0;
    this.stats.laced++;
    this._loop(true);
    this._toast('Skates on — stick to skate · PUNCH stops · JUMP spins · ENTER takes them off', 3600);
    return true;
  }

  /** Off the skates (ENTER, a respawn, leaving the ice some other way). */
  stop(pl, quiet = false) {
    if (!this.me) return;
    const m = this.me;
    this.me = null;
    if (pl.skate === this) pl.skate = null;
    pl.h.group.rotation.z = 0;
    pl.speed = 0;
    this._loop(false);
    const kmh = Math.round(m.vTop * 3.6);
    if (kmh > this.best.kmh) this.best.kmh = kmh;
    this._save();
    if (!quiet) this._toast(`Skates off${kmh > 4 ? ` — top speed ${kmh} km/h` : ''}`, 2400);
  }

  /** The frame on skates (player.updateFoot hands it over). Returns true: it moved and posed you. */
  step(pl, dt, input) {
    const m = this.me;
    if (!m) { pl.skate = null; return false; }
    dt = Math.min(dt, 0.05);
    const c = this.o.controls;
    let tapJump = false;
    if (c && c.tapped === 'jump') { c.tapped = null; tapJump = true; }
    const mag = Math.min(1, Math.hypot(input.x, input.y));
    let speed = Math.hypot(m.vx, m.vz);
    // the stick: where you want to go, camera-relative (player.js's sense)
    const want = Math.atan2(-input.x, -input.y) + pl.camYaw + Math.PI;
    const stopping = !!input.attack && m.spin <= 0;
    // --- a spin: from a near standstill, JUMP
    if ((tapJump || (input.jump && !m.jumpHeld)) && m.spin <= 0 && speed < 3.2) {
      m.spin = 1; m.spinT = 0; m.spinA = 0; m.spinW = 10 + 3 * (1 - speed / 3.2);
      this.stats.spins++;
    }
    m.jumpHeld = !!input.jump;
    if (m.spin > 0) {
      m.spinT += dt;
      m.spinW *= Math.exp(-0.5 * dt);                     // it winds down
      const turn = m.spinW * dt;
      m.spinA += turn; m.hd += turn;
      if (m.spinW < 2.2 || m.spinT > 5 || (mag > 0.5 && m.spinT > 0.6)) {
        const revs = m.spinA / (Math.PI * 2);
        if (revs > this.best.spin) { this.best.spin = +revs.toFixed(1); this._save(); }
        this._toast(`Scratch spin: ${revs.toFixed(1)} turns${revs >= this.best.spin && revs > 2 ? ' — your best' : ''}`, 2200);
        m.spin = 0;
      }
    }
    // --- turning: slower the faster you go
    const vmax = input.sprint ? VSPRINT : VMAX;
    if (m.spin <= 0) {
      let target = m.hd;
      if (stopping) {
        // a hockey stop: the body swings side-on to the way you are going
        if (m.tStop === 0) { m.stopSide = Math.sign(wrap(want - Math.atan2(m.vx, m.vz))) || 1; this.stats.stops++; }
        target = Math.atan2(m.vx, m.vz) + (Math.PI / 2) * (m.stopSide || 1);
        m.tStop += dt;
      } else {
        m.tStop = 0;
        if (mag > 0.12) target = want;
      }
      const rate = stopping ? 9 : (2.9 - 1.6 * clamp(speed / VMAX, 0, 1));
      m.hd += clamp(wrap(target - m.hd), -rate * dt, rate * dt);
    }
    const fx = Math.sin(m.hd), fz = Math.cos(m.hd);
    // --- the push: strides along the way you face, harder from slow
    let pushing = 0;
    if (mag > 0.12 && !stopping && m.spin <= 0) {
      // facing well away from the way you are going: you are turning round, and a stride brakes first
      pushing = mag;
      const stroke = 0.55 + 0.75 * Math.max(0, Math.sin(m.ph)) + 0.75 * Math.max(0, -Math.sin(m.ph));
      const a = (input.sprint ? 3.4 : 2.3) * mag * stroke * clamp(1 - speed / vmax, 0, 1);
      m.vx += fx * a * dt; m.vz += fz * a * dt;
    }
    m.push += ((pushing ? 0.35 + 0.65 * pushing : 0) - m.push) * Math.min(1, dt * 5);
    // --- the blades: velocity carried round toward the way the skates point (forwards or backwards)
    speed = Math.hypot(m.vx, m.vz);
    if (speed > 0.05 && m.spin <= 0) {
      const va = Math.atan2(m.vx, m.vz);
      const fwd = Math.abs(wrap(m.hd - va)) < Math.PI * 0.6;
      const blade = fwd ? m.hd : m.hd + Math.PI;
      if (stopping) {
        // side-on, the blades scrape: a hard stop, and snow
        const dec = 7.5 * Math.min(1, m.tStop * 6);
        const ns = Math.max(0, speed - dec * dt);
        m.vx *= ns / speed; m.vz *= ns / speed;
        if (speed > 1.2) this._spray(pl, speed);
      } else {
        const dA = wrap(blade - va), turn = clamp(dA, -3.2 * dt, 3.2 * dt);
        const na = va + turn, ns = speed * (1 - 0.12 * Math.abs(turn));
        m.vx = Math.sin(na) * ns; m.vz = Math.cos(na) * ns;
      }
    }
    // --- the glide: ice friction and the air
    speed = Math.hypot(m.vx, m.vz);
    if (speed > 0) {
      const dec = (MU * (m.spin > 0 ? 3 : 1) + DRAG * speed * speed) * dt;
      const ns = Math.max(0, speed - dec);
      m.vx *= ns / speed; m.vz *= ns / speed;
      speed = ns;
    }
    m.vTop = Math.max(m.vTop, speed);
    if (speed * 3.6 > this.best.kmh + 0.5) this.best.kmh = Math.round(speed * 3.6);
    // --- move, and the curb: the boards bounce you back
    let nx = pl.x + m.vx * dt, nz = pl.z + m.vz * dt;
    const [u, v] = this._uv(nx, nz);
    const s = this._sdf(u, v, BODY);
    if (s.d > 0) {
      const [ex, ez] = [this.R.u[0] * s.nu - this.R.u[1] * s.nv, this.R.u[1] * s.nu + this.R.u[0] * s.nv];
      nx -= ex * s.d; nz -= ez * s.d;
      const vn = m.vx * ex + m.vz * ez;
      if (vn > 0) {
        m.vx -= ex * vn * 1.35; m.vz -= ez * vn * 1.35;    // a little rebound
        m.vx *= 0.82; m.vz *= 0.82;
        if (vn > 1.6) { this.stats.bounces++; this._sfx('thunk', clamp(vn * 0.12, 0.15, 0.6), 0.8); }
      }
    }
    // ...and the other skaters: a nudge apart
    for (const q of this.skaters) {
      if (!q.p) continue;
      const dx = nx - q.p.x, dz = nz - q.p.z, d = Math.hypot(dx, dz);
      if (d < 0.75 && d > 1e-3) { nx += dx / d * (0.75 - d) * 0.6; nz += dz / d * (0.75 - d) * 0.6; }
    }
    pl.x = nx; pl.z = nz;
    pl.y = this.R.y;
    pl.grounded = true; pl.vy = 0;
    pl.camFootY = pl.y;
    pl.heading = m.hd;
    pl.speed = speed;
    // --- the pose: strides by distance, the bank by the turn's speed
    m.ph += dt * (pushing ? 4.2 + 1.6 * clamp(speed / VMAX, 0, 1) : 0) + (pushing ? 0 : 0);
    const yawRate = m.prevHd === undefined ? 0 : wrap(m.hd - m.prevHd) / Math.max(dt, 1e-3);
    m.prevHd = m.hd;
    const lean = m.spin > 0 ? 0 : clamp(speed * yawRate / 9.81, -0.38, 0.38);
    m.lean += (lean - m.lean) * Math.min(1, dt * 6);
    m.stop += ((stopping && speed > 0.3 ? 1 : 0) - m.stop) * Math.min(1, dt * 10);
    const h = pl.h;
    h.group.position.set(pl.x, pl.y - CROUCH, pl.z);
    h.group.rotation.y = m.hd;
    skatePose(h, { ph: m.ph, push: m.push, stop: m.stop, spin: m.spin, lean: m.lean });
    // the blades' hiss
    this._loopLevel(speed, stopping);
    return true;
  }

  // --- the crowd on the ice ------------------------------------------------------------

  /** The frame (main.js): bring skaters out near the rink, send them home far from it, and check on you. */
  update(dt, camera, player) {
    if (!this.ok) return;
    const R = this.R, cx = camera.position.x, cz = camera.position.z;
    const d = Math.hypot(cx - R.c[0], cz - R.c[1]);
    if (this.me && (!player.onFoot || !this.onIce(player.x, player.z) && Math.hypot(player.x - R.c[0], player.z - R.c[1]) > 25)) this.stop(player, true);
    // a word on stepping onto the ice, once a visit
    if (!this.me && player.onFoot) {
      const on = this.onIce(player.x, player.z, player.y);
      if (on && !this.told) { this.told = true; this._toast('The rink at Waterloo Public Square — press ENTER to lace up your skates', 3200); }
      else if (!on && Math.hypot(player.x - R.c[0], player.z - R.c[1]) > 40) this.told = false;
    }
    // the skaters' own bookkeeping: drop any the crowd took back (knocked down, recycled)
    for (let i = this.skaters.length - 1; i >= 0; i--) {
      const q = this.skaters[i];
      if (!q.p || !q.p.h.group.parent || q.p.state === 'down' || q.p.skate !== q) { if (q.p && q.p.skate === q) q.p.skate = null; this.skaters.splice(i, 1); }
    }
    const peds = this.o.peds;
    if (d > LEAVE) {
      // gone: give them back to the crowd (removed: they would walk off the ice onto nothing)
      for (const q of this.skaters) { q.p.skate = null; peds.remove(q.p); }
      this.skaters.length = 0;
      return;
    }
    if (d > RANGE) return;
    const want = this.o.phone ? 4 : 7;
    this._spawnT = (this._spawnT || 0) - dt;
    if (this.skaters.length < want && this._spawnT <= 0) {
      this._spawnT = 0.6;
      this._spawnSkater(cx, cz);
    }
  }

  _spawnSkater(cx, cz) {
    const R = this.R, peds = this.o.peds;
    const k = this.stats.spawned++;
    // its lane: a rounded loop inset from the curb, its pace, and where on the loop it starts
    const lane = 0.42 + ((k * 0.37) % 0.45);
    const q = {
      lane, th: (k * 2.39) % (Math.PI * 2), spd: 2.2 + ((k * 0.61) % 1) * 2.6, v: 0,
      ph: k, push: 0.6, lean: 0, wob: (k % 5 === 3) ? 1 : 0,           // one in five is still learning
      p: null, sk: this,
      drive: (p, dt) => this._drive(q, p, dt),
      pose: (h, p) => skatePose(h, { ph: q.ph, push: q.push, stop: 0, spin: 0, lean: q.lean + (q.wob ? Math.sin(q.ph * 0.7) * 0.12 : 0) }),
    };
    const [x, z] = this._loop2(q, q.th);
    const [x2, z2] = this._loop2(q, q.th + 0.05);
    const p = peds.spawnTrail(x, z, R.y + 0.6, Math.atan2(x2 - x, z2 - z), cx, cz);
    if (!p) return;
    p.trail = null;
    p.skate = q;
    q.p = p;
    q.v = q.spd * 0.6;
    this.skaters.push(q);
  }

  /** A point of skater q's loop at parameter th (counter-clockwise from the long axis's +u end). */
  _loop2(q, th) {
    const R = this.R, n = 4;
    const c = Math.cos(th), s = Math.sin(th);
    const u = (R.hl - 1.2) * q.lane * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const v = (R.hw - 1.2) * q.lane * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    return this._xz(u * 1.0, v * (0.75 + 0.25 * q.lane));
  }

  _drive(q, p, dt) {
    dt = Math.min(dt, 0.1);
    // ease up behind someone (you included) on the loop ahead
    let slow = 1;
    const hx = Math.sin(p.heading), hz = Math.cos(p.heading);
    const others = [this.o.player, ...this.skaters.map((o) => o.p)];
    for (const o of others) {
      if (!o || o === p) continue;
      const dx = o.x - p.x, dz = o.z - p.z, ahead = dx * hx + dz * hz, side = Math.abs(dx * hz - dz * hx);
      if (ahead > 0 && ahead < 2.2 && side < 0.9) slow = Math.min(slow, ahead / 2.2);
    }
    const target = q.spd * (q.wob ? 0.55 : 1) * (0.25 + 0.75 * slow);
    q.v += clamp(target - q.v, -2.5 * dt, 1.2 * dt);
    q.push = q.v < target - 0.1 || slow < 0.9 ? 0.75 : 0.35 + 0.25 * Math.sin(q.th * 3 + q.ph * 0.1) ** 2;
    // advance along the loop by arc length
    const [x0, z0] = this._loop2(q, q.th), [x1, z1] = this._loop2(q, q.th + 0.01);
    const dsd = Math.hypot(x1 - x0, z1 - z0) / 0.01 || 1;
    const dth = (q.v * dt) / dsd;
    q.th = (q.th + dth) % (Math.PI * 2);
    const [x, z] = this._loop2(q, q.th);
    const [xa, za] = this._loop2(q, q.th + 0.04);
    const hd = Math.atan2(xa - x, za - z);
    const yawRate = wrap(hd - p.heading) / Math.max(dt, 1e-3);
    q.lean += (clamp(q.v * yawRate / 9.81, -0.3, 0.3) - q.lean) * Math.min(1, dt * 4);
    p.x = x; p.z = z; p.y = this.R.y - CROUCH;
    p.heading = hd;
    p.speed = q.v;
    q.ph += dt * (3.4 + q.v * 0.35);
  }

  // --- sound, snow, words ---------------------------------------------------------------

  _loop(on) {
    const a = this.o.audio, ctx = a && a.ctx;
    if (!ctx) return;
    if (on && !this.hiss) {
      // the blades on the ice: looped noise through a high band-pass, with the speed
      const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = n.getChannelData(0);
      let b = 0;
      for (let i = 0; i < d.length; i++) { b = 0.6 * b + 0.4 * (Math.random() * 2 - 1); d[i] = b; }
      const src = ctx.createBufferSource(); src.buffer = n; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(a.master || ctx.destination); src.start();
      this.hiss = { src, f, g };
    } else if (!on && this.hiss) {
      const h = this.hiss; this.hiss = null;
      h.g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => { try { h.src.stop(); h.src.disconnect(); } catch (e) { /* gone */ } }, 500);
    }
  }
  _loopLevel(speed, scraping) {
    const h = this.hiss;
    if (!h) return;
    const t = h.g.context.currentTime;
    h.g.gain.setTargetAtTime(scraping && speed > 0.5 ? 0.32 : Math.min(0.16, speed * 0.025), t, 0.06);
    h.f.frequency.setTargetAtTime(scraping ? 1800 : 2600 + speed * 180, t, 0.06);
  }
  _spray(pl, speed) {
    const fx = this.o.fx;
    if (!fx || !fx.emit) return;
    const m = this.me;
    if ((m.sprayT = (m.sprayT || 0) + 1) % 2) return;
    const vx = m.vx / (speed || 1), vz = m.vz / (speed || 1);
    fx.emit(pl.x + vx * 0.4, this.R.y + 0.08, pl.z + vz * 0.4, 3, { r: 0.94, g: 0.97, b: 1, size: 0.16, life: 0.45, spread: 0.25, vy: 1.2, grav: 4, jitter: 0.9 });
  }
  _sfx(name, gain, rate) { const a = this.o.audio; if (a && a.play) a.play(name, { gain, rate }); }
  _toast(s, ms) { const hud = this.o.hud && this.o.hud.hud; if (hud) hud.showToast(s, ms); }
  _save() { try { localStorage.setItem('autokw-skate', JSON.stringify(this.best)); } catch (e) { /* private */ } }
}
