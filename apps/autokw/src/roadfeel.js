// YOUR ROAD CAR OVER THE SMALL THINGS IN THE GROUND (Auto KW).
//
// The heightfield is 40 m and the roads are smooth strips, so nothing in the
// world's own surface is small enough to feel: a bridge's expansion joints,
// ION's rails where a road crosses them or runs along them, the milled rumble
// strips on a freeway shoulder. This finds them under YOUR car's wheels each
// frame (spec.roadCar with detailedWheels -- the AI's cars never ask), kicks
// the car's suspension through `Vehicle.bump` (heave, pitch by axle, roll by
// side) and plays them through audio.js (`roadHit`, the `rumble` loop).
//
//   joints   on a deck ('deck' from main.js surfaceAt), every ~32-36 m: front
//            axle, then rear after wheelbase / speed. Getting on or off a
//            deck is the approach slab's joint, a little harder.
//   rails    each ION track (link.js) within 8 m: the signed distance of each
//            axle's centre from the track's centreline, against the two rails
//            at +-0.7175 m (standard gauge); crossing one is a hit. Where ION
//            runs in the street (`tr.ST`) the rails are flush and grooved, so
//            softer; at a crossing's panels harder. Only at the track's height.
//   rumble   highways.js `rumbleAt` under each of the four wheels: the left
//            and right sides separately (a strip is one-sided), a buzz in the
//            body and the camera, and the groove-rate loop in audio.js.
//   bottomed Vehicle.update's bump stop (`v.bottomed`): the clunk.

import { rumbleAt } from './highways.js';
import { clamp } from './util.js';

const RAIL = 0.7175;          // half of 1435 mm
const JOINT_PITCH = 32;       // m between a deck's joints (+0-4 m)

export class RoadFeel {
  constructor(audio, player) {
    this.audio = audio;
    this.player = player;
    this.v = null;
    this.rumble = 0;          // 0..1.4 for audio.js (both sides louder than one)
    this.active = false;      // a road car of yours on the ground: the joints are ours, not audio.js's
    this.jointD = 20;
    this.wasDeck = false;
    this.lat = new Map();     // track key -> [front lat, rear lat] last frame
    this.pending = [];        // [secs, amp, axle] rear-axle hits to come
    this.stats = { joints: 0, rails: 0, rumbleT: 0, bottoms: 0, slabs: 0 };
  }

  reset() {
    this.rumble = 0; this.active = false; this.lat.clear(); this.pending.length = 0; this.jointD = 20; this.wasDeck = false;
  }

  update(dt, v, surface, link) {
    if (v !== this.v) { this.reset(); this.v = v; }
    if (!v || !v.detailedWheels || !v.spec.roadCar || v.dead) { this.reset(); return; }
    const A = this.audio, P = this.player;
    if (v.bottomed > 0) {
      if (A) A.roadHit('bottom', 0.35 + 0.65 * v.bottomed);
      if (P) P.shake = Math.max(P.shake || 0, 0.12 * v.bottomed);
      this.stats.bottoms++;
      v.bottomed = 0;
    }
    if (v.onGround === false || v.stunt) { this.rumble = 0; this.active = true; this.lat.clear(); return; }
    this.active = true;
    const sp = Math.abs(v.vLong), heavy = (v.spec.mass || 1) > 2.5;
    const wb = v.spec.wheelbase || 2.8;
    // rear-axle hits due now
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const q = this.pending[i];
      if ((q[0] -= dt) <= 0) { v.bump(q[1], 1, 0); this.pending.splice(i, 1); }
    }

    // --- a deck's joints, and the approach slabs at either end ---
    const deck = surface === 'deck';
    if (sp > 3 && deck !== this.wasDeck) {
      const amp = clamp(sp / 22, 0.35, 1.1);
      this._hit('joint', amp, (heavy ? 0.5 : 0.38) * clamp(sp / 22, 0.4, 1.1), wb, sp);
      this.stats.slabs++;
      this.jointD = Math.random() * 4;
    } else if (deck && sp > 3) {
      this.jointD += sp * dt;
      if (this.jointD > JOINT_PITCH) {
        this.jointD = Math.random() * 4;
        const amp = clamp(sp / 25, 0.3, 1);
        this._hit('joint', amp * 0.75, clamp(sp / 25, 0.3, 1) * (heavy ? 0.42 : 0.3), wb, sp);
        this.stats.joints++;
      }
    }
    this.wasDeck = deck;

    const f = v.forward, rx = f.z, rz = -f.x;   // (rx, rz): the body's local +X
    const W = v.assets.wheels;
    let zf = wb / 2, zr = -wb / 2, xw = v.halfWid * 0.8;
    if (W && W.length) {
      zf = -1e9; zr = 1e9; xw = 0;
      for (const w of W) { zf = Math.max(zf, w[2]); zr = Math.min(zr, w[2]); xw = Math.max(xw, Math.abs(w[0])); }
    }

    // --- ION's rails ---
    if (link && link.tracks && sp > 0.5) {
      for (const k in link.tracks) {
        const tr = link.tracks[k];
        if (!tr || !tr.X || !tr.cells) continue;
        const q = tr.nearest(v.x, v.z, 8);
        if (!q) { this.lat.delete(k); continue; }
        if (tr.Y && Math.abs(tr.y(q.s) - v.y) > 1.5) { this.lat.delete(k); continue; }
        if (tr.F && tr.flag(q.s) === 1) { this.lat.delete(k); continue; }
        const i = tr.idx(q.s), h = tr.H[i], c = Math.cos(h), s = Math.sin(h);
        const latAt = (oz) => (v.x + f.x * oz - tr.X[i]) * c - (v.z + f.z * oz - tr.Z[i]) * s;
        const now = [latAt(zf), latAt(zr)];
        const was = this.lat.get(k);
        this.lat.set(k, now);
        if (!was) continue;
        const street = !!(tr.ST && tr.ST[i]);
        for (let ax = 0; ax < 2; ax++) {
          const a = was[ax], b = now[ax];
          if (Math.abs(b - a) > 2.5) continue;
          for (const r of [-RAIL, RAIL]) {
            if ((a - r) * (b - r) < 0) {
              const amp = (street ? 0.4 : 0.75) * clamp(sp / 12, 0.3, 1.2);
              v.bump(amp, ax, 0);
              if (A) A.roadHit('rail', (0.22 + 0.4 * amp) * (heavy ? 1.15 : 1));
              if (P && ax === 0) P.shake = Math.max(P.shake || 0, 0.035 * amp);
              this.stats.rails++;
            }
          }
        }
      }
    } else this.lat.clear();

    // --- the shoulder rumble strips ---
    let L = 0, R = 0;
    if (sp > 3) {
      for (const oz of [zf, zr]) {
        const px = v.x + f.x * oz, pz = v.z + f.z * oz;
        if (rumbleAt(px + rx * xw, pz + rz * xw, v.y)) R = 1;    // +X side
        if (rumbleAt(px - rx * xw, pz - rz * xw, v.y)) L = 1;
      }
    }
    this.rumble = (L + R) * 0.75;
    if (L || R) {
      this.stats.rumbleT += dt;
      // the grooves come at 80-100 a second: at 60 fps that is a buzz, so it
      // is felt as a random shiver in the body and the view, not as bumps
      const k = clamp(sp / 25, 0.4, 1.2);
      v.susHeaveV = (v.susHeaveV || 0) + (Math.random() - 0.5) * 0.5 * k;
      v.susRollV = (v.susRollV || 0) + (R - L) * (Math.random() - 0.3) * 0.25 * k;
      if (P) P.shake = Math.max(P.shake || 0, 0.045 * k);
    }
  }

  /** A joint under the front axle now and the rear one wheelbase / speed later. */
  _hit(kind, amp, gain, wb, sp) {
    const v = this.v, A = this.audio, P = this.player;
    v.bump(amp, 0, 0);
    const dtR = wb / Math.max(sp, 1);
    if (dtR < 0.8) this.pending.push([dtR, amp * 0.9, 1]);
    if (A) {
      A.roadHit(kind, gain);
      if (dtR < 0.6) A.roadHit(kind, gain * 0.8, dtR);
    }
    if (P) P.shake = Math.max(P.shake || 0, 0.03 * amp);
  }
}
