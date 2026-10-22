// Auto KW: SCHOOL BUSES STOP (see "School buses stop" in apps/autokw/CLAUDE.md).
//
// A school bus in traffic (vehicles.js `schoolbus`) on a residential or
// collector street stops now and then for children, more often near a school,
// in school hours by the device's clock, and runs Ontario's sequence
// (Highway Traffic Act s. 175; the MTO handbooks):
//
//   1 AMBER   the overhead ambers flash while it slows to its stop
//   2 RED     stopped: the reds flash, the stop arm swings out, children step
//             off at the door and walk away (the crowd's own pedestrians,
//             peds.spawnFareAt, as grtbus.js's alighting riders)
//   3 CLOSE   the arm swings in (the reds still on); then they go off and it
//             pulls away
//
// While its reds flash, traffic BOTH ways stops at least 20 m short of it; on
// a road with a median (a divided road: its carriageways are separate one-way
// edges) only traffic behind it. During the ambers, traffic behind drops back
// to stop 20 m short of where the bus will stand.
//
// Traffic reads none of this unless a bus is stopping (`list`), and nothing
// here draws on traffic's rng: the choices are hashes of the bus's spawn
// number, so `window.__noSchoolStops = true` (before boot, or any time) gives
// traffic exactly master's behaviour -- tools/kw/trafficbench.js's hashes.
//
// Harness: window.__sbHour (0-24) stands in for the clock; window.__sbGap (m)
// replaces the distance between stops; window.__sbKids the children per stop.

import { hash2 } from './util.js';
import { twoWayLayout } from './arterial.js';
import { kwData } from './kw.js';
import { LAMP_SB, SB_ARM_STEPS } from './vehicles.js';

// school hours (local, h): the morning run to the afternoon's last drop-off
const HOUR_FROM = 7.0, HOUR_TO = 17.5;
// metres between stops: near a school (SCHOOL_R m of one) and elsewhere
const GAP_NEAR = [110, 200], GAP_FAR = [350, 650], SCHOOL_R = 700;
// the stop: planned this far ahead (m) at least, never within JCT_CLEAR m of
// the ends of its edge (a junction); traffic stops HOLD_BACK m short of the bus
export const HOLD_BACK = 20;
const PLAN_MIN = 40, JCT_CLEAR = 25, BUS_DECEL = 1.1;
// the stop arm's swing (s), the children (each KID_DT s apart), the wait after
// the last one (s), the flash (s a side: ~75 a minute)
const ARM_T = 0.7, KID_DT = 0.9, KID_WAIT = 2.6, FLASH = 0.4;
// a red code's arm steps: 2 + side + 2 x step
const codeOf = (side, k) => 2 + side + 2 * Math.round(Math.max(0, Math.min(1, k)) * (SB_ARM_STEPS - 1));

const on = () => !(typeof window !== 'undefined' && window.__noSchoolStops);
export { on as schoolStopsOn };

export class SchoolStops {
  constructor(traffic) {
    this.T = traffic;
    this.list = [];       // buses mid-stop (phase 1-3): traffic obeys these
    this.kids = [];       // { p, t }: children walking off, handed back to the crowd after a while
    this._school = null;  // school centroids by 500 m cell
    this._hourT = -1; this._hourOK = true;
    this.stats = { stops: 0, kids: 0, passes: 0, aborted: 0 };
  }

  /** In school hours? (the device's clock, read once a second; __sbHour overrides) */
  hourOK() {
    const now = Date.now() / 1000;
    if (typeof window !== 'undefined' && window.__sbHour != null) { const h = +window.__sbHour; return h >= HOUR_FROM && h < HOUR_TO; }
    if (now - this._hourT > 1 || now < this._hourT) {
      this._hourT = now;
      const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
      this._hourOK = h >= HOUR_FROM && h < HOUR_TO;
    }
    return this._hourOK;
  }

  /** Is (x, z) within SCHOOL_R of a school? (kw.json's school footprints and named schools) */
  nearSchool(x, z) {
    if (!this._school) {
      const m = new Map(), K = (x, z) => `${Math.floor(x / 500)},${Math.floor(z / 500)}`;
      const add = (x, z) => { const k = K(x, z); if (!m.has(k)) m.set(k, []); m.get(k).push(x, z); };
      const KW = kwData();
      if (KW) {
        for (const p of KW.polys || []) {
          if (p[1] !== 'school' || !p[3] || !p[3].length) continue;
          let sx = 0, sz = 0;
          for (const q of p[3]) { sx += q[0]; sz += q[1]; }
          add(sx / p[3].length, sz / p[3].length);
        }
        for (const n of KW.named || []) if (n[3] === 'school') add(n[1], n[2]);
      }
      this._school = { m, K };
    }
    const { m } = this._school, cx = Math.floor(x / 500), cz = Math.floor(z / 500), r2 = SCHOOL_R * SCHOOL_R;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const a = m.get(`${cx + i},${cz + j}`);
      if (!a) continue;
      for (let k = 0; k < a.length; k += 2) if ((a[k] - x) ** 2 + (a[k + 1] - z) ** 2 < r2) return true;
    }
    return false;
  }

  /** The distance to the next stop, from where this one ends. */
  gap(v, n) {
    if (typeof window !== 'undefined' && window.__sbGap != null) return +window.__sbGap;
    const h = hash2(v.prio | 0, 7001 + n), G = this.nearSchool(v.x, v.z) ? GAP_NEAR : GAP_FAR;
    return G[0] + (G[1] - G[0]) * h;
  }

  /**
   * The bus's own driving (traffic.js driveTraffic, a school bus in traffic):
   * plans the next stop, runs the sequence, and returns where it must stop
   * (m, as driveTraffic's stopAt), or Infinity.
   */
  busDrive(v, s0, sp, dt, rt, R) {
    let S = v.sb;
    if (!S) {
      S = v.sb = { phase: 0, odo: 0, n: 0, next: 0, t: 0, k: 0, kidsLeft: 0, kidT: 0, lastKid: 0,
        rem: 0, twoWay: true, fined: false, plSide: 0 };
      S.next = this.gap(v, 0) * (0.3 + 0.7 * hash2(v.prio | 0, 7919));
    }
    if (S.phase === 0) {
      S.odo += sp * dt;
      if (S.odo < S.next || sp < 3) return Infinity;
      const T = this.T, ei = rt[R.EI];
      if (!this.okEdge(ei)) return Infinity;
      // one lane its way: a two-way street of one lane a side, or a one-way
      // carriageway it is in the kerb lane of (a divided road's)
      if (T.flow[ei] !== 0) { const n = T.laneInfo(ei).n; if (n > 1 && (v.laneU == null || v.laneU < (n - 1) / n)) return Infinity; }
      if (!this.hourOK()) return Infinity;
      // THE STOP, `need` m on along the route: every way out to JCT_CLEAR past
      // it one the bus may stop on, and no junction (a node of three or more
      // ways, or a controlled one) on the way there or within JCT_CLEAR past it
      // (the way behind: `need` is more than JCT_CLEAR, so the last junction
      // is at least that far behind the stop)
      const need = Math.max(PLAN_MIN, (sp * sp) / (2 * BUS_DECEL) + 6), reach = need + JCT_CLEAR;
      const city = T.city, jc = T.jc;
      let D = rt[R.LEN] - s0, twoWay = T.flow[ei] === 0, ok = false;
      for (let j = 0; j < v.rtN; j++) {
        const o = j * R.F, ej = rt[o + R.EI], e = city.edges[ej];
        if (j > 0) { if (!this.okEdge(ej) || (T.flow[ej] === 0) !== twoWay) break; D += rt[o + R.LEN]; }
        const ni = rt[o + R.SG] > 0 ? e.b : e.a;
        if (D >= reach) { ok = true; break; }
        if (city.nodes[ni].e.length !== 2 || (jc && jc.ctl[ni] >= 0)) break;
      }
      if (!ok) return Infinity;
      S.twoWay = twoWay;
      S.rem = need;
      S.phase = 1; S.t = 0; S.k = 0; S.fined = false; S.plSide = 0;
      S.kidsLeft = typeof window !== 'undefined' && window.__sbKids != null ? +window.__sbKids : 1 + Math.floor(hash2(v.prio | 0, 4243 + S.n) * 5);
      this.list.push(v);
      this.stats.stops++;
      T.stats.sbStops = (T.stats.sbStops || 0) + 1;
    }
    S.t += dt;
    if (S.phase === 1) {
      // (the distance still to go, by the odometer: the stop is along the route)
      const rem = (S.rem -= sp * dt);
      if (sp < 0.4 && rem < 4) { S.phase = 2; S.t = 0; return 0; }
      // overshot it, or held up (a queue, a crash) for too long: not this time
      if (rem < -4 || S.t > 40) { this.end(v); this.stats.aborted++; return Infinity; }
      return Math.max(0, rem);
    }
    S.rem = 0;
    if (S.phase === 2) {
      S.k = Math.min(1, S.k + dt / ARM_T);
      if (S.k >= 1 && S.t > ARM_T + 0.8) {
        if (S.kidsLeft > 0) {
          S.kidT -= dt;
          if (S.kidT <= 0) { S.kidT = KID_DT; S.kidsLeft--; S.lastKid = S.t; this.kid(v); }
        } else if (S.t - S.lastKid > KID_WAIT) { S.phase = 3; S.t = 0; }
      }
      return 0;
    }
    // phase 3: the arm in, then the reds off and away
    S.k = Math.max(0, S.k - dt / ARM_T);
    if (S.k <= 0) { this.end(v); return Infinity; }
    return 0;
  }

  /** Can a bus stop for children on edge ei? A residential or collector
   *  street at ground level, not a freeway's. Two-way of one lane a side, or one-way. */
  okEdge(ei) {
    const T = this.T, e = T.city.edges[ei];
    if (!e || !(e.cls === 'res' || e.cls === 'st') || e.elev || e.tunnel || T.fwy[ei]) return false;
    return T.flow[ei] !== 0 || !twoWayLayout(e);
  }

  /** The stop is over (or abandoned): lamps off, the next one planned. */
  end(v) {
    const S = v.sb;
    S.phase = 0; S.k = 0; S.odo = 0; S.n++;
    S.next = this.gap(v, S.n);
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** A vehicle leaving the world (traffic.remove). */
  drop(v) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** The lamp state (vehicles.js LAMP_SB + code) of a bus mid-stop, or -1. */
  lampBits(v, t) {
    const S = v.sb;
    if (!S || !S.phase) return -1;
    const side = Math.floor((t + hash2(v.prio | 0, 41)) / FLASH) & 1;
    return LAMP_SB + (S.phase === 1 ? side : codeOf(side, S.k));
  }

  /**
   * Another car's duty (driveTraffic, every traffic car while `list` has a
   * bus): how far it may go (m, as stopAt), or Infinity. The bus is found on
   * the car's own sampled PATH (ps / sg: x, z pairs; dx, dz, length), so a car
   * about to turn into the street sees it, and one turning away does not.
   */
  obey(v, ps, sg, np) {
    let res = Infinity;
    const vx = v.x, vz = v.z;
    for (const b of this.list) {
      if (b === v) continue;
      const S = b.sb;
      if (Math.abs(b.x - vx) > 120 || Math.abs(b.z - vz) > 120 || Math.abs(b.y - v.y) > 3) continue;
      let best = Infinity, along = 0, acc = 0, sdx = 0, sdz = 0;
      for (let k = 0; k < np - 1; k++) {
        const ax = ps[2 * k], az = ps[2 * k + 1], sx = sg[3 * k], sz = sg[3 * k + 1], l = sg[3 * k + 2];
        let t = ((b.x - ax) * sx + (b.z - az) * sz) / (l * l);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = b.x - ax - sx * t, ez = b.z - az - sz * t, dd = ex * ex + ez * ez;
        if (dd < best) { best = dd; along = acc + t * l; sdx = sx / l; sdz = sz / l; }
        acc += l;
      }
      if (best > 12 * 12) continue;
      const bf = b.forward, dir = bf.x * sdx + bf.z * sdz, red = S.phase >= 2;
      if (dir > 0.7) {
        // behind it, its way (any lane of it)
        if (best > 7 * 7) continue;
        const rearNow = along - b.halfLen - v.halfLen;
        if (rearNow < -1) continue;   // (beside it already: a lane over, past it)
        if (red) { res = Math.min(res, Math.max(0, rearNow - HOLD_BACK)); continue; }
        // the ambers: drop back to stop HOLD_BACK short of where it will stand
        // -- or, already closer than that, keep HOLD_BACK off it as it slows
        const g = rearNow + (S.rem || 0) - HOLD_BACK;
        if (g > 0) res = Math.min(res, g);
        else if (rearNow - HOLD_BACK > 0) res = Math.min(res, rearNow - HOLD_BACK);
      } else if (dir < -0.7 && red && S.twoWay) {
        // coming the other way, no median between: stop HOLD_BACK short of its front
        const front = along - b.halfLen - v.halfLen;
        if (front < 1) continue;   // alongside already
        res = Math.min(res, Math.max(0, front - HOLD_BACK));
      }
    }
    return res;
  }

  /** A child steps off at the door (kerb side, behind the front wheel) and walks away. */
  kid(v) {
    const peds = this.T.peds;
    if (!peds) return;
    const f = v.forward, rx = -f.z, rz = f.x;   // right of travel: the kerb side
    const dz = SB_DOOR_Z, dx = v.halfWid + 0.45;
    const x = v.x + f.x * dz + rx * dx, z = v.z + f.z * dz + rz * dx;
    const k = this.stats.kids++, h = hash2(k, 77);
    const tx = x + rx * 9 + f.x * (h * 12 - 6), tz = z + rz * 9 + f.z * (h * 12 - 6);
    const p = peds.spawnFareAt(x, z, v.y + 1, tx, tz);
    if (!p) return;
    // a child: two thirds of a grown-up's height, give or take
    const sc = 0.58 + 0.14 * hash2(k, 78);
    p.h.group.scale.setScalar(sc); p.h.scale = sc; p.h.height = 1.75 * sc;
    p.kid = true;
    this.kids.push({ p, t: 0 });
  }

  /**
   * Once a frame (traffic.update, after the cars): the children handed back to
   * the crowd once they are off the road, and YOU -- passing a bus whose reds
   * are flashing is an offence (s. 175(11)): `onPass(policeNear)`.
   */
  update(dt, player) {
    const peds = this.T.peds;
    for (let i = this.kids.length - 1; i >= 0; i--) {
      const K = this.kids[i];
      K.t += dt;
      if (!peds || !peds.peds.includes(K.p)) { this.kids.splice(i, 1); continue; }
      if (K.t > 5) { K.p.fare = 0; K.p.state = 'walk'; peds.reanchor(K.p); this.kids.splice(i, 1); }
    }
    // a bus that is nobody's to drive any more (you took it, a crash left it
    // 'free') ends its stop: nothing else would turn its reds off
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (b.mode !== 'traffic' || (player && b === player.vehicle)) this.end(b);
    }
    const pv = player && !player.onFoot ? player.vehicle : null;
    if (!pv || !this.list.length) return;
    for (const b of this.list) {
      const S = b.sb;
      if (S.phase < 2 || S.fined || pv === b) continue;
      const rx = pv.x - b.x, rz = pv.z - b.z, f = b.forward;
      const lon = rx * f.x + rz * f.z, lat = Math.abs(rx * f.z - rz * f.x);
      if (lat > 12 || Math.abs(pv.y - b.y) > 3 || Math.abs(lon) > 60) { S.plSide = 0; continue; }
      const side = lon > b.halfLen + 1 ? 1 : lon < -b.halfLen - 1 ? -1 : 0;
      if (!side) continue;
      // past it, one way or the other, moving -- the other way across a median is no offence
      const pf = pv.forward, opp = pf.x * f.x + pf.z * f.z < 0;
      if (S.plSide && side !== S.plSide && Math.abs(pv.vLong) > 1.5 && !(opp && !S.twoWay)) {
        S.fined = true;
        this.stats.passes++;
        if (this.T.onSchoolBusPass) this.T.onSchoolBusPass(this.policeNear(pv.x, pv.z));
      }
      S.plSide = side;
    }
  }

  /** A police car or an officer near enough to see it. */
  policeNear(x, z) {
    for (const c of this.T.cars) {
      if (!(c.mode === 'police' || c.unit || (c.spec.police && c.mode === 'traffic'))) continue;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < 150 * 150) return true;
    }
    const peds = this.T.peds;
    if (peds) for (const p of peds.peds) if (p.cop && (p.x - x) ** 2 + (p.z - z) ** 2 < 70 * 70) return true;
    return false;
  }
}

// the door: its middle, metres ahead of the bus's centre (buildSchoolBus DOOR)
const SB_DOOR_Z = 10.9 / 2 - 2.05 - 0.52;
