// Auto KW: the drive-throughs (kwshops.js driveLane draws them from OSM's
// service=drive-through lanes; driveThrus() lists them).
//
//   - THE LINE: cars queued in each lane near you, nose to tail back from the
//     window, as long as the hour makes it -- Tims' morning line (6-10 am, by
//     the clock on your phone) is the longest, lunch and supper the others'.
//     Every so often the car at the window pulls away and the rest creep up a
//     car length. They are scenery, not traffic: traffic.decor draws them
//     (traffic.js updateFarLod: the nearest in their type's detailed model,
//     the rest through the far LOD, one instanced draw per type for every
//     scenery car in view), so a line costs no draws of its own, and nothing
//     here touches traffic's cars, its random numbers or its hash. Their types
//     are the driveways' mix (kwdriveway.js sceneryType).
//   - YOU IN IT: drive into a lane and the cars behind you go, the ones ahead
//     stay (solid: you stop against the bumper ahead) and are served quicker,
//     so you are at the window in a minute, not ten.
//   - THE WINDOW: stopped at it, ENTER orders (main.js tryDriveThru, before
//     getting out): a double-double at a Tims is Roll Up the Rim's (rollup.js);
//     anywhere else the chain's coffee or its thing for a couple of dollars
//     (game.money), and a little health. The next ENTER there gets you out.
//
// Harness: __dbg.dthru (`hour` pins the clock, `list` the lanes, `order()`).

import * as THREE from './three.js';
import * as G from './geo.js';
import { vehicleAssets, randomCarColor } from './vehicles.js';
import { SCENERY_TYPES, sceneryType } from './kwdriveway.js';
import { hash2 } from './util.js';

const GAP = 6.4;          // nose to nose in the line
const NEAR = 230;         // lanes this close keep a line
// what each window sells for a couple of dollars (the wallet is whole dollars), and the health it gives
const MENU = {
  mcd: ['a medium McCafé coffee', 2, 8], wendys: ['a small Frosty', 2, 8], harveys: ['an order of onion rings', 3, 12],
  aw: ['a frosty mug of root beer', 2, 8], bk: ['a Whopper Jr.', 4, 14], kfc: ['fries and gravy', 4, 12],
  starbucks: ['a grande Pike Place', 3, 8], popeyes: ['Cajun fries', 3, 10], dq: ['a small Blizzard', 5, 12],
  subway: ['a cookie', 2, 5], swiss: ['a quarter chicken dinner', 9, 18],
};
const NAME = { mcd: "McDonald's", wendys: "Wendy's", harveys: "Harvey's", aw: 'A&W', bk: 'Burger King', kfc: 'KFC', starbucks: 'Starbucks',
  popeyes: 'Popeyes', dq: 'Dairy Queen', subway: 'Subway', swiss: 'Swiss Chalet', tims: 'Tim Hortons' };

/** How many in the line at this hour: Tims' morning rush, everyone's lunch and supper. */
export function lineFor(tims, hour) {
  if (tims) return hour >= 6 && hour < 10 ? 7 : hour >= 10 && hour < 14 ? 4 : hour >= 14 && hour < 19 ? 3 : hour >= 19 && hour < 23 ? 2 : 1;
  return hour >= 11 && hour < 14 ? 4 : hour >= 17 && hour < 20 ? 3 : hour >= 7 && hour < 23 ? 1 : 0;
}

export class DriveThrus {
  /** opts: { traffic, hud, audio, money: () => n, charge(n) -> bool, heal(n) } */
  constructor(list, opts) {
    this.o = opts;
    this.hour = null;            // pinned by a harness; else the clock's
    this.list = list.map((d, i) => {
      const P = d.pts, n = P.length / 3;
      // the lane's middle and reach, for the distance test
      let cx = 0, cz = 0;
      for (let k = 0; k < n; k++) { cx += P[k * 3]; cz += P[k * 3 + 1]; }
      cx /= n; cz /= n;
      let r = 0;
      for (let k = 0; k < n; k++) r = Math.max(r, Math.hypot(P[k * 3] - cx, P[k * 3 + 1] - cz));
      return Object.assign({}, d, { i, n, cx, cz, r, phase: hash2(i, 3) * 40, cars: null, you: null, hinted: false, lock: false });
    });
    this.decor = opts.traffic.decor;
    this.pool = [];
    this._col = new Map();
    // (their near and far LODs are built at boot: main.js traffic.sceneryTypes)
    const types = vehicleAssets().types;
    this.types = SCENERY_TYPES.filter((t) => types[t]);
    this.pivot = Object.fromEntries(this.types.map((t) => [t, types[t].spec.pivotY || 0]));
    this.half = Object.fromEntries(this.types.map((t) => [t, [types[t].spec.len / 2, types[t].spec.wid / 2]]));
    this.served = 0;
  }

  get clockHour() { return this.hour !== null ? this.hour : new Date().getHours(); }

  /** A point s metres along lane d: [x, z, heading]. Before the start it runs back along the first leg. */
  at(d, s) {
    const P = d.pts, n = d.n;
    if (s <= 0) {
      const dx = P[3] - P[0], dz = P[4] - P[1], l = Math.hypot(dx, dz) || 1;
      return [P[0] + (dx / l) * s, P[1] + (dz / l) * s, Math.atan2(dx, dz)];
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m * 3 + 2] <= s) lo = m; else hi = m; }
    const s0 = P[lo * 3 + 2], s1 = P[hi * 3 + 2], t = s1 > s0 ? Math.min(1, (s - s0) / (s1 - s0)) : 0;
    const x = P[lo * 3] + (P[hi * 3] - P[lo * 3]) * t, z = P[lo * 3 + 1] + (P[hi * 3 + 1] - P[lo * 3 + 1]) * t;
    // heading from a little behind to a little ahead (smooth through the bends)
    const a = this._pt(d, s - 1.5), b = this._pt(d, s + 1.5);
    return [x, z, Math.atan2(b[0] - a[0], b[1] - a[1])];
  }
  _pt(d, s) {
    const P = d.pts, n = d.n;
    s = Math.max(0, Math.min(P[(n - 1) * 3 + 2], s));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m * 3 + 2] <= s) lo = m; else hi = m; }
    const s0 = P[lo * 3 + 2], s1 = P[hi * 3 + 2], t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    return [P[lo * 3] + (P[hi * 3] - P[lo * 3]) * t, P[lo * 3 + 1] + (P[hi * 3 + 1] - P[lo * 3 + 1]) * t];
  }
  /** Where (x, z) is along lane d: { s, off } (off: metres across), or null if not by it. */
  project(d, x, z, reach = 3.2) {
    const P = d.pts, n = d.n;
    let best = null, bd = reach * reach;
    for (let k = 0; k + 1 < n; k++) {
      const ax = P[k * 3], az = P[k * 3 + 1], bx = P[k * 3 + 3], bz = P[k * 3 + 4];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      if (l2 < 1e-4) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const qx = ax + dx * t, qz = az + dz * t, d2 = (x - qx) ** 2 + (z - qz) ** 2;
      if (d2 < bd) { bd = d2; best = { s: P[k * 3 + 2] + t * Math.sqrt(l2), d: Math.sqrt(d2) }; }
    }
    return best;
  }

  colorOf(id) {
    let c = this._col.get(id);
    if (!c) { c = new THREE.Color(randomCarColor(id)); this._col.set(id, c); if (this._col.size > 400) this._col.clear(); }
    return c;
  }

  /** Each frame, before traffic draws: the lines near (px, pz), and the player's car kept out of them. */
  update(dt, px, pz, player) {
    this.decor.length = 0;
    const v = player && !player.onFoot ? player.vehicle : null;
    const road = v && !v.dead && !(v.spec && (v.spec.plane || v.spec.boat || v.spec.rail || v.spec.balloon)) ? v : null;
    const hour = this.clockHour;
    for (const d of this.list) {
      const far = Math.hypot(d.cx - px, d.cz - pz) > NEAR + d.r;
      if (far) { d.you = null; d.hinted = false; d.lock = false; continue; }
      // you, in the lane (along it, facing the way it runs)
      d.you = null;
      if (road) {
        const pr = this.project(d, road.x, road.z, 2.6);
        if (pr && pr.s < d.sW + 4) {
          const h = this.at(d, pr.s)[2], dh = Math.abs(((road.heading - h + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (dh < 1.2) d.you = pr.s;
        }
      }
      // the line: `want` cars, the one at the window served every `per` s (quicker with you in it)
      const want = Math.min(lineFor(d.tims, hour), Math.max(0, Math.floor((d.sW + 4) / GAP)));
      if (!want && d.you === null) continue;
      const per = d.you !== null ? 5 : d.tims ? 26 : 34;
      d.phase += dt / per;
      const k0 = Math.floor(d.phase), f = d.phase - k0;
      // the first ~4 s of each cycle: the served car pulls away and the rest creep up a car length
      const mv = Math.min(1, (f * per) / 4), ease = mv * mv * (3 - 2 * mv);
      for (let j = -1; j < want; j++) {
        const id = k0 + j + 1;                       // a car's number: the same car as it moves up
        let s;
        if (j < 0) {
          // the served one, leaving: from the window on along the lane (gone at its end)
          s = d.sW + ease * 18 + f * per * 3;
          if (mv >= 1 || s > d.len - 2 || (d.you !== null && d.you > d.sW - GAP)) continue;
        } else s = d.sW - (j + 1 - ease) * GAP;
        if (d.you !== null && j >= 0 && s < d.you + 1) continue;   // behind you (or beside): gone
        if (s < -GAP * 2.5) continue;
        const [x, z, h] = this.at(d, s);
        const type = sceneryType(hash2(id, d.i * 7 + 1));
        if (!this.pivot.hasOwnProperty(type)) continue;
        const car = this.pool[this.decor.length] || (this.pool[this.decor.length] = {});
        car.type = type; car.x = x; car.z = z; car.h = h; car.y = G.terrainHeight(x, z); car.pivotY = this.pivot[type];
        car.col = this.colorOf((id * 131 + d.i * 17) | 0);
        car.lane = d;
        this.decor.push(car);
      }
    }
    if (road) this.keepOut(road);
    this.hint(road);
  }

  /** The player's car against the line's: pushed back out of any it drove into, its speed into it taken away. */
  keepOut(v) {
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    for (const c of this.decor) {
      const dx = c.x - v.x, dz = c.z - v.z;
      if (dx * dx + dz * dz > 100) continue;
      const [hl, hw] = this.half[c.type], gx = Math.sin(c.h), gz = Math.cos(c.h);
      // separating axes: both cars' length and width
      let best = Infinity, nx = 0, nz = 0;
      for (const [ux, uz] of [[fx, fz], [fz, -fx], [gx, gz], [gz, -gx]]) {
        const ra = v.halfLen * Math.abs(fx * ux + fz * uz) + v.halfWid * Math.abs(fz * ux - fx * uz);
        const rb = hl * Math.abs(gx * ux + gz * uz) + hw * Math.abs(gz * ux - gx * uz);
        const dd = dx * ux + dz * uz, o = ra + rb - Math.abs(dd);
        if (o <= 0) { best = -1; break; }
        if (o < best) { best = o; nx = dd < 0 ? -ux : ux; nz = dd < 0 ? -uz : uz; }
      }
      if (best <= 0) continue;
      v.x -= nx * best; v.z -= nz * best;
      // the velocity along the normal (into the parked car) goes; a bump, not a crash
      const wx = fx * v.vLong + fz * v.vLat, wz = fz * v.vLong - fx * v.vLat;
      const into = wx * nx + wz * nz;
      if (into > 0) {
        const ax = wx - nx * into * 1.2, az = wz - nz * into * 1.2;
        v.vLong = ax * fx + az * fz; v.vLat = ax * fz - az * fx;
      }
    }
  }

  /** The lane whose window you are stopped at (6 m), or null. */
  windowAt(v) {
    let best = null, bd = 6;
    for (const d of this.list) {
      if (Math.abs(d.cx - v.x) > d.r + 10 || Math.abs(d.cz - v.z) > d.r + 10) continue;
      const dd = Math.hypot(v.x - d.x, v.z - d.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  hint(v) {
    if (!v || Math.abs(v.vLong) > 3) return;
    const d = this.windowAt(v);
    if (!d || d.hinted) return;
    d.hinted = true;
    const name = NAME[d.k] || d.who || 'the drive-thru';
    if (d.tims) this.o.hud.showToast(`Tim Hortons drive-thru — ENTER for a double-double (and Roll Up the Rim)`, 3600);
    else {
      const m = MENU[d.k] || ['a coffee', 2, 8];
      this.o.hud.showToast(`${name} drive-thru — ENTER for ${m[0]} ($${m[1]})`, 3600);
    }
  }

  /**
   * ENTER in a stopped road vehicle at a window (main.js tryDriveThru): order.
   * Returns 'tims' (rollup.js takes it), true (served here), 'out' (the
   * second ENTER there: get out) or null (not at a window).
   */
  order(pl) {
    const v = pl.vehicle;
    if (pl.onFoot || !v || v.dead || Math.abs(v.vLong || 0) > 2.5) return null;
    const sp = v.spec || {};
    if (sp.plane || sp.boat || sp.floats || sp.rail || sp.balloon || v.afloat || v.airborne) return null;
    const d = this.windowAt(v);
    if (!d) return null;
    if (d.tims) return 'tims';
    if (d.lock) { d.lock = false; return 'out'; }
    const m = MENU[d.k] || ['a coffee', 2, 8];
    const name = NAME[d.k] || d.who || 'The drive-thru';
    if (!this.o.charge(m[1])) {
      this.o.hud.showToast(`${name}: that's $${m[1]} — you're short. ENTER again to get out`, 3200);
      d.lock = true;
      return true;
    }
    this.o.heal(m[2]);
    this.served++;
    d.lock = true;
    this.last = { k: d.k, item: m[0], price: m[1], health: m[2] };
    if (this.o.audio && this.o.audio.play) this.o.audio.play('slosh', { gain: 0.6, rate: 1.4 });
    this.o.hud.showToast(`${name}: ${m[0]}, $${m[1]}. Thanks, see you tomorrow! (+${m[2]} health)`, 4200);
    return true;
  }
}
