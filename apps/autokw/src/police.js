// The law: what each wanted level sends after you, how it fights, how it
// loses you, and how it arrests you. See "Wanted levels" in CLAUDE.md.
//
// traffic.js still spawns and drives the units (spawnPolice / drivePolice) and
// peds.js walks the officers on foot; both ask this module what to do --
// how many of what (LEVELS), where to go (carTarget / footOrders), when to
// stop and get out (deploy) -- and every police weapon fires through `fire`.
// The helicopters are this module's own.
//
// THE ESCALATION, one row per star (caps on units ACTIVE near you; a unit that
// has got out of its car counts its officers, not the car):
//   1  two patrol cars; officers who stop by you get out and ARREST -- no
//      shooting. Stopped, on foot or in a car with a cop at the door: BUSTED.
//   2  three cars; officers shoot pistols, from a stopped car too.
//   3  four cars and the helicopter: it follows you, watching, with a
//      marksman, and while it sees you the heat does not cool.
//   4  SWAT: two armoured vans that ram, then stop and put four tactical
//      officers on the street with carbines (3-round bursts, tracers).
//   5  more of everything, two helicopters with door gunners, heavier fire.
//
// LOSING THEM is GTA's search: the police know where they last SAW you
// (a unit within sight range -- 70 m for a car, 40 m on foot, the helicopter
// while its search point is on you and you are not under a deck or in a
// bore -- no beam is drawn: it is always daytime). Out of sight,
// they drive to that point and search around it, the stars flash, and after
// 6 + 3 x stars seconds unseen one star goes. Seen again, the clock restarts.

import * as THREE from './three.js';
import * as G from './geo.js';
import { clamp, lerp, angleWrap, dist2 } from './util.js';
import { Vehicle } from './vehicles.js';

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/**
 * Per wanted level. cars / vans / foot / helis are caps on what is active;
 * `street` officers are walked in from the pavement (the rest come out of
 * the units' doors). carGun: a stopped car's crew shoots through the window;
 * footGun: officers on foot shoot (at 1 star they only arrest); `hold`: the
 * stand-off officers keep and shoot from instead of closing to arrest;
 * `ram`: how hard the cars drive into you inside 18 m (m/s); `block`: two
 * more cruisers parked across the street ahead of you (a roadblock).
 */
export const LEVELS = [
  { cars: 0, vans: 0, foot: 0, swat: 0, street: 0, helis: 0, heliGun: null, carGun: false, footGun: false, hold: 0, ram: 12, dmg: 1 },
  { cars: 2, vans: 0, foot: 2, swat: 0, street: 0, helis: 0, heliGun: null, carGun: false, footGun: false, hold: 0, ram: 12, dmg: 1 },
  { cars: 3, vans: 0, foot: 3, swat: 0, street: 0, helis: 0, heliGun: null, carGun: true, footGun: true, hold: 0, ram: 14, dmg: 1 },
  { cars: 4, vans: 0, foot: 4, swat: 0, street: 2, helis: 1, heliGun: 'marksman', carGun: true, footGun: true, hold: 7, ram: 18, dmg: 1 },
  { cars: 3, vans: 2, foot: 3, swat: 4, street: 1, helis: 1, heliGun: 'gunner', carGun: true, footGun: true, hold: 11, ram: 22, dmg: 1.1 },
  { cars: 4, vans: 3, foot: 3, swat: 6, street: 1, helis: 2, heliGun: 'gunner', carGun: true, footGun: true, hold: 12, ram: 24, dmg: 1.25, block: 2 },
];

/**
 * burst: rounds per trigger pull, `gap` s between them; `cd` the [min, max]
 * pause between bursts; `acc` the chance a round hits a standing target at
 * point blank (falls to half at full range, and with the target's speed);
 * `dmg` per hit; `streak` draws a travelling tracer instead of a flash line.
 */
export const WEAPONS = {
  pistol: { burst: 1, gap: 0, cd: [1.1, 2.0], range: 34, acc: 0.55, dmg: [6, 11], streak: false },
  rifle: { burst: 3, gap: 0.11, cd: [1.3, 1.9], range: 48, acc: 0.36, dmg: [7, 10], streak: true },
  marksman: { burst: 1, gap: 0, cd: [2.4, 3.2], range: 140, acc: 0.42, dmg: [9, 13], streak: true },
  gunner: { burst: 5, gap: 0.09, cd: [2.4, 3.2], range: 140, acc: 0.18, dmg: [6, 9], streak: true },
  // a fleeing suspect's driver (police missions), out of his window
  suspect: { burst: 1, gap: 0, cd: [1.3, 2.3], range: 32, acc: 0.38, dmg: [4, 8], streak: false },
};

// sight ranges: how the police know where you are. Out of every unit's
// sight they still track you for TRACK s (the radio: a unit that has just
// lost you calls out where you went) before the search begins.
const SEE_CAR = 110, SEE_FOOT = 45, SEE_HELI = 140, HELI_EYES = 95, HELI_SPOT = 30, TRACK = 2.5;
// ...and a crime is a call: the units are sent to where it happened for
// DISPATCH s, or every unit spawned out of sight (90-320 m) searched instead
// of coming, and two stars took 20 s to find a man standing still.
const DISPATCH = 15;
const HELI_SPEED = 42, HELI_ACC = 11, HELI_AGL = 64;
const BUST_FOOT = 0.7, BUST_CAR = 1.6;

const ORD = { heading: 0, speed: 0, remove: false };

export class Police {
  constructor({ scene, city, game, traffic, peds, fx, audio, hud }) {
    this.scene = scene; this.city = city; this.game = game;
    this.traffic = traffic; this.peds = peds; this.fx = fx; this.audio = audio; this.hud = hud;
    this.player = null;
    this.helis = [];
    // where they last saw you, and whether they can see you now
    this.lastX = 0; this.lastZ = 0;
    this.seen = false; this.searching = false; this.unseenT = 0;
    this.trackLeft = 0;   // s they still know where you are after losing sight
    this.covered = false; this._coverT = 0; this.coverTop = 0;
    this.playerSlow = false;
    this.bustT = 0;
    this.n = { cars: 0, vans: 0, foot: 0, swat: 0, helis: 0 };   // active units, counted each frame
    this.stats = { spawned: { car: 0, swat: 0, cop: 0, swatOfficer: 0, heli: 0 }, shots: 0, hits: 0, busts: 0, wedged: { car: 0, swat: 0 } };
    this._wasWanted = 0;
    this._drop = null;
    this.blockT = 8;     // s to the next roadblock (5 stars)
    // No searchlight is drawn (v193). The game is always in daylight, and a
    // lit cone from the nose to the ground read as a strange glowing wedge.
    // The helicopter still aims a search point (aimX/Z) and sees you by it.
  }

  level() { return LEVELS[clamp(this.game.wanted | 0, 0, 5)]; }

  /** Meshes made lazily in play, for main.js's warm-up frames (Hitches): none now. */
  warmMeshes() { return []; }

  /** A crime was seen where you are (game.addHeat). */
  spotted(x, z) {
    this.lastX = x; this.lastZ = z;
    this.seen = true; this.searching = false; this.unseenT = 0;
    this.trackLeft = Math.max(this.trackLeft, DISPATCH);
  }

  // --- the frame ------------------------------------------------------------

  update(dt, player, buried) {
    const game = this.game, T = this.traffic;
    this.player = player;
    const p = player.position;
    const px = p.x, pz = p.z;
    const L = this.level();
    const v0 = player.vehicle && !player.onFoot ? player.vehicle : null;
    const pSpeed = v0 ? Math.abs(v0.vLong) : player.speed || 0;
    this.playerSlow = v0 ? pSpeed < 3 : pSpeed < 2.6;

    // Under something: a bore, a viaduct, a bridge deck. The air unit cannot
    // see through it (main.js's `buried` is the bore case; the deck over you
    // is the highest surface at your feet).
    this._coverT -= dt;
    if (this._coverT <= 0) {
      this._coverT = 0.25;
      const top = this.city.groundAt(px, pz, null);
      this.covered = !!buried || top > p.y + 2.6;
      this.coverTop = top;
    }

    if (game.wanted > 0 && this._wasWanted === 0) this.spotted(px, pz);
    this._wasWanted = game.wanted;

    // --- count what is out, and who can see you ---------------------------------
    let seen = false;
    const n = this.n;
    n.cars = 0; n.vans = 0; n.foot = 0; n.swat = 0;
    for (const v of T.cars) {
      if (!v.unit || v.dead) continue;
      const d2 = dist2(v.x, v.z, px, pz);
      if (v.mode === 'police') {
        if (v.unit === 'swat') n.vans++; else n.cars++;
        if (d2 < SEE_CAR * SEE_CAR && Math.abs(v.y - p.y) < 12) seen = true;
      } else if (v.mode === 'free' && v.crew > 0 && d2 < 200 * 200) {
        // a unit whose crew is out on foot: its officers count, and the car
        // keeps its place (they will get back in)
        if (v.unit === 'swat') n.vans++; else n.cars++;
      } else if (v.mode === 'free' && v.crew === 0 && d2 > 160 * 160 && v !== player.vehicle && v.lightL) {
        // left behind empty (its crew down, or walked off when the heat
        // went): out of the picture
        this._drop = v;
      }
      // the light bar strobes on any unit with its crew, driving or not
      // (traffic.policeLights; dark once the heat is gone)
      if (v.lightL && (v.mode === 'police' || v.crew > 0)) T.policeLights(v, dt, game.wanted > 0);
    }
    if (this._drop) { T.remove(this._drop); this._drop = null; }
    for (const c of this.peds.peds) {
      if (!c.cop || c.state === 'down') continue;
      if (c.kind === 'swat') n.swat++; else n.foot++;
      if (dist2(c.x, c.z, px, pz) < SEE_FOOT * SEE_FOOT && Math.abs(c.y - p.y) < 8) seen = true;
    }

    // --- the helicopters ----------------------------------------------------------
    const wantH = game.wanted > 0 ? L.helis : 0;
    let active = 0;
    for (const h of this.helis) if (!h.leaving) active++;
    if (active < wantH) { this.helis.push(new Heli(this, this.helis.length)); this.stats.spawned.heli++; }
    else if (active > wantH) {
      for (let i = this.helis.length - 1; i >= 0 && active > wantH; i--) {
        if (!this.helis[i].leaving) { this.helis[i].leaving = true; active--; }
      }
    }
    for (let i = this.helis.length - 1; i >= 0; i--) {
      const h = this.helis[i];
      h.update(dt, this, L, player, v0);
      if (h.sees) seen = true;
      if (h.gone) { h.dispose(this.scene); this.helis.splice(i, 1); }
    }
    n.helis = active;

    // --- the search --------------------------------------------------------------
    if (game.wanted > 0) {
      if (seen) {
        this.seen = true; this.searching = false;
        this.lastX = px; this.lastZ = pz;
        this.unseenT = 0;
        this.trackLeft = Math.max(this.trackLeft, TRACK);
        game.cool = 0;
      } else {
        this.seen = false;
        this.trackLeft -= dt;
        if (this.trackLeft > 0) { this.lastX = px; this.lastZ = pz; }
        this.searching = this.trackLeft <= 0;
        // the cool-down clock runs while they search (main.js takes the stars)
        if (this.searching) this.unseenT += dt;
        game.cool = this.unseenT;
      }
    } else { this.seen = false; this.searching = false; this.unseenT = 0; }

    // --- units that have stopped by you get out --------------------------------
    if (game.wanted > 0 && !game.dead) {
      for (const v of T.cars) {
        if (v.mode !== 'police' || !v.unit || v.dead) continue;
        const d2 = dist2(v.x, v.z, px, pz);
        // A crew that has just got back in stays in a while: you crawling
        // away and stopping again was out, in, out -- 76 tactical officers
        // spawned in a minute round a stuck Wedge at five stars.
        if (v.deployCd > 0) {
          v.deployCd -= dt;
          if (L.carGun && !this.searching && d2 < 26 * 26 && Math.abs(v.vLong) < 9) this.tickGun(v, WEAPONS.pistol, dt, v.x, v.y + 1.3, v.z, true);
          continue;
        }
        if (v.unit === 'swat') {
          // A van deploys beside a slow target; held up within 45 m of one
          // for 4 s (a queue, a wall between); or once it has been in your
          // face for 7 s (a ram that has stopped pushing).
          if (d2 < 45 * 45) v.rammed += dt; else v.rammed = 0;
          const sv = Math.abs(v.vLong);
          if ((d2 < 28 * 28 && (this.playerSlow || v.rammed > 7) && sv < 4)
            || (this.playerSlow && v.rammed > 4 && sv < 1.5)
            || (v.offGraph && this.playerSlow && d2 < 160 * 160 && sv < 1.5)) this.deploy(v, 4, 'swat');
        } else if ((d2 < 17 * 17 || (v.offGraph && d2 < 160 * 160)) && this.playerSlow && Math.abs(v.vLong) < 1.5) {
          // (a target on a piece of the street graph it cannot drive to --
          // a waterfront promenade, a plaza -- is finished on foot, from as
          // near as it got)
          this.deploy(v, 2, 'cop');
        } else if (L.carGun && !this.searching && d2 < 26 * 26 && Math.abs(v.vLong) < 9) {
          // the passenger shoots through the window
          this.tickGun(v, WEAPONS.pistol, dt, v.x, v.y + 1.3, v.z, true);
        }
      }
    }

    // --- roadblocks: at five stars, two cruisers across the street ahead --------
    this.blockT -= dt;
    if (L.block && game.wanted > 0 && !game.dead && v0 && !v0.spec.plane && !v0.spec.boat && pSpeed > 10 && !this.searching && this.blockT <= 0) {
      this.blockT = this.roadblock(px, pz, v0) ? 28 : 3;
    }

    // --- busted -------------------------------------------------------------------
    // An officer on foot at your side while you are not getting away: held
    // for a moment, and you are under arrest. In a car, one at the door of a
    // car that has stopped.
    if (game.wanted > 0 && !game.dead) {
      const reach = v0 ? 3.4 : 1.5;
      let near = false;
      if (this.playerSlow && !(v0 && (v0.spec.plane || v0.spec.boat || v0.spec.rail))) {
        for (const c of this.peds.peds) {
          if (!c.cop || c.state === 'down') continue;
          if (dist2(c.x, c.z, px, pz) < reach * reach && Math.abs(c.y - p.y) < 2) { near = true; break; }
        }
      }
      this.bustT = near ? this.bustT + dt : Math.max(0, this.bustT - dt * 2);
      if (this.bustT > (v0 ? BUST_CAR : BUST_FOOT)) {
        this.bustT = 0;
        this.stats.busts++;
        if (game.onBusted) game.onBusted();
      }
    } else this.bustT = 0;

    // HUD: the police on the minimap (helicopters), the stars flashing while
    // they search
    if (this.hud) { this.hud.policeHelis = this.helis; this.hud.searching = this.searching; }
  }

  /** The helicopter nearest (x, z), for the rotor sound: its position or null. */
  nearestHeli(x, z) {
    let best = null, bd = Infinity;
    for (const h of this.helis) {
      const d = dist2(h.x, h.z, x, z);
      if (d < bd) { bd = d; best = h.v.group.position; }
    }
    return best;
  }

  /** Everything off the street at once (a respawn, a bust). */
  clear() {
    for (const h of this.helis) h.dispose(this.scene);
    this.helis.length = 0;
    for (const c of [...this.peds.peds]) if (c.cop) this.peds.remove(c);
    for (const v of [...this.traffic.cars]) {
      if (v.unit && v !== (this.player && this.player.vehicle) && (v.mode === 'police' || v.crew > 0)) this.traffic.remove(v);
    }
    this.bustT = 0; this.seen = false; this.searching = false; this.unseenT = 0; this.trackLeft = 0;
  }

  /**
   * Two cruisers parked nose to nose across the street 140-260 m ahead of
   * you, an officer behind each (they count as their units; they get back in
   * and come after you once you are past). False if there is no surface
   * junction ahead to block.
   */
  roadblock(px, pz, v0) {
    const city = this.city, T = this.traffic;
    const f = v0.forward;
    const ni = city.nearestNode(px + f.x * 200, pz + f.z * 200, 70);
    if (ni == null || ni < 0) return false;
    const n = city.nodes[ni];
    const dx = n.x - px, dz = n.z - pz, d = Math.hypot(dx, dz);
    if (d < 140 || d > 260 || (dx * f.x + dz * f.z) / d < 0.85) return false;
    let hw = 99;
    for (const ei of n.e) {
      const e = city.edges[ei];
      if (e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp') return false;
      hw = Math.min(hw, e.hw);
    }
    if (n.elev || T.wet && T.wet(n.x, n.z)) return false;
    const ux = dx / d, uz = dz / d, rx = uz, rz = -ux, off = clamp(hw * 0.5, 2.2, 3.0);
    const L = this.level();
    // the two cruisers are the level's `block` on top of its cars; their
    // officers come out of its foot cap
    if (this.n.cars + 2 > L.cars + L.block || this.n.foot + 2 > L.foot) return false;
    for (const s of [-1, 1]) {
      const v = T.spawnUnitAt(n.x + rx * off * s, n.z + rz * off * s, Math.atan2(-rx * s, -rz * s), 'car');
      if (!v) continue;
      v.vLong = 0; v.mode = 'free'; v.crew = 0;
      const c = this.peds.spawnOfficer(n.x + rx * off * s + ux * 3.2, n.z + rz * off * s + uz * 3.2, 'cop', v);
      if (c) { v.crew = 1; this.stats.spawned.cop++; }
      this.n.cars++;
    }
    this.stats.roadblocks = (this.stats.roadblocks || 0) + 1;
    return true;
  }

  // --- the units' orders --------------------------------------------------------

  /** Where a police car should drive: you, the search, or (heat gone) away. */
  carTarget(v, px, pz, dt) {
    if (this.game.wanted === 0) {
      const f = v.forward;
      return { x: v.x + f.x * 200, z: v.z + f.z * 200, speed: 13 };
    }
    if (!this.searching) return null;
    // search: each unit picks a point near where you were last seen, and a
    // new one when it gets there
    v.searchT -= dt;
    if (v.searchT <= 0 || dist2(v.x, v.z, v.searchX, v.searchZ) < 18 * 18) {
      const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 70;
      v.searchX = this.lastX + Math.cos(a) * r; v.searchZ = this.lastZ + Math.sin(a) * r;
      v.searchT = 8;
    }
    return { x: v.searchX, z: v.searchZ, speed: 20 };
  }

  /**
   * Put a unit's crew on the street: `count` officers out of its doors (as
   * many as the level's foot cap allows), and the car parks with its lights
   * going. They get back in when you drive off (footOrders).
   */
  deploy(v, count, kind) {
    const L = this.level();
    const room = kind === 'swat' ? Math.max(0, L.swat - this.n.swat) : Math.max(0, L.foot - this.n.foot);
    const k = Math.min(count, room);
    if (!k) return;   // nobody may get out: it stays a driven unit, stopped by you
    v.vLong *= 0.3;
    v.mode = 'free';
    v.crew = 0;
    const f = v.forward, rx = f.z, rz = -f.x;
    for (let i = 0; i < k; i++) {
      const side = i % 2 ? 1 : -1, along = (i < 2 ? 0.6 : -1.6) * (v.halfLen / 2.5);
      const x = v.x + rx * side * (v.halfWid + 0.8) + f.x * along;
      const z = v.z + rz * side * (v.halfWid + 0.8) + f.z * along;
      const c = this.peds.spawnOfficer(x, z, kind, v);
      if (c) { v.crew++; this.n[kind === 'swat' ? 'swat' : 'foot']++; this.stats.spawned[kind === 'swat' ? 'swatOfficer' : 'cop']++; }
    }
    if (!v.crew) v.mode = 'police';
  }

  /**
   * What an officer on foot does this frame (peds.js): fills and returns ORD
   * { heading, speed, remove }. Shoots and closes to arrest as the level says.
   */
  footOrders(c, dt, px, pz, player) {
    const game = this.game, L = this.level();
    const o = ORD;
    o.remove = false;
    const d = Math.hypot(px - c.x, pz - c.z);
    // heat gone: walk away, gone out of sight or after a while
    if (game.wanted === 0 || game.dead) {
      c.aim = 0;
      c.leaveT += dt;
      o.heading = Math.atan2(c.x - px, c.z - pz);
      o.speed = 1.4;
      o.remove = c.leaveT > 9 || d > 55;
      return o;
    }
    c.leaveT = 0;
    const inCar = !!(player.vehicle && !player.onFoot);
    // You drove off: back to the car, and the car back on the road.
    const car = c.car;
    if (car && inCar && d > 34 && !car.dead && car.mode === 'free' && car.group.parent) {
      const dc = Math.hypot(car.x - c.x, car.z - c.z);
      if (dc < 2.6) {
        // in; the last one in drives off (peds.remove counts the crew down)
        if (car.crew <= 1 && car !== player.vehicle) { car.mode = 'police'; car.path = null; car.repath = 0; car.deployCd = 15; }
        o.remove = true;
        return o;
      }
      c.aim = 0;
      o.heading = Math.atan2(car.x - c.x, car.z - c.z);
      o.speed = 4.4;
      return o;
    }
    if (inCar && d > 110) { o.remove = true; return o; }
    let tx = px, tz = pz;
    if (this.searching) {
      // looking for you where you were last seen
      if (dist2(c.x, c.z, c.searchX, c.searchZ) < 4 || c.searchX === 0) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 30;
        c.searchX = this.lastX + Math.cos(a) * r; c.searchZ = this.lastZ + Math.sin(a) * r;
      }
      tx = c.searchX; tz = c.searchZ;
    }
    const dt2 = Math.hypot(tx - c.x, tz - c.z);
    o.heading = Math.atan2(tx - c.x, tz - c.z);
    const swat = c.kind === 'swat';
    const W = swat ? WEAPONS.rifle : WEAPONS.pistol;
    // Close to arrest at the low levels, or whenever you are standing still
    // within reach of it; otherwise hold a stand-off and shoot from it.
    const closing = !this.searching && (L.hold === 0 || (this.playerSlow && d < L.hold + 4 && !swat));
    const stand = this.searching ? 2 : closing ? 0.9 : L.hold;
    o.speed = dt2 > stand ? (swat ? 4.3 : 4.7) : 0;
    if (this.searching) o.speed = Math.min(o.speed, 2.6);
    // shoot: from 2 stars, when they can see you; a closing officer holds his
    // fire in the last few metres (he is reaching for the cuffs)
    const fireOk = L.footGun && !this.searching && d < W.range && !(closing && d < 5 && this.playerSlow);
    c.aim = lerp(c.aim, fireOk ? 1 : 0, 1 - Math.exp(-8 * dt));
    if (fireOk && c.aim > 0.6) {
      o.speed = Math.min(o.speed, 1.2);   // they stop to aim
      this.tickGun(c, W, dt, c.x, c.y + 1.38, c.z, true);
    } else if (c.burst === 0) c.shootCd = Math.max(c.shootCd - dt, 0.25);
    return o;
  }

  // --- guns -----------------------------------------------------------------------

  /**
   * Run a shooter's trigger (`s` carries shootCd / burst): fires the rounds
   * of a burst `gap` apart, and starts a burst when `canFire` and its
   * cooldown is up.
   */
  tickGun(s, W, dt, x, y, z, canFire) {
    s.shootCd -= dt;
    if (s.burst <= 0) {
      if (!canFire || s.shootCd > 0) return;
      s.burst = W.burst;
    }
    if (s.shootCd > 0) return;
    this.fire(x, y, z, W, s);
    s.burst--;
    s.shootCd = s.burst > 0 ? W.gap : W.cd[0] + Math.random() * (W.cd[1] - W.cd[0]);
  }

  /** One round from (x, y, z) at the player. Police and suspects alike. */
  fire(x, y, z, W, from = null) {
    const game = this.game, P = this.player;
    if (!P || game.dead) return false;
    const v = P.vehicle && !P.onFoot ? P.vehicle : null;
    const p = P.position;
    const ty = v ? v.y + 1.0 : p.y + 1.2;
    const dx = p.x - x, dy = ty - y, dz = p.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (d > W.range || d < 0.5) return false;
    const speed = v ? Math.abs(v.vLong) : P.speed || 0;
    const L = this.level();
    const pHit = W.acc * (1 - 0.5 * d / W.range) / (1 + speed / 14);
    const hit = Math.random() < pHit;
    this.stats.shots++;
    // a miss goes past you, a metre or three off
    let ex = p.x, ey = ty, ez = p.z;
    if (!hit) {
      const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 2;
      ex += Math.cos(a) * r + dx / d * 6; ez += Math.sin(a) * r + dz / d * 6; ey += dy / d * 6 - 0.6;
    }
    if (this.audio) this.audio.gunshot(x, z);
    if (this.fx) {
      if (W.streak) this.fx.streak(x, y, z, ex, ey, ez);
      else this.fx.tracer(x, y, z, ex, ey, ez);
      this.fx.sparks(x + dx / d * 0.8, y, z + dz / d * 0.8, 2);
    }
    if (!hit) return false;
    this.stats.hits++;
    const dmg = (W.dmg[0] + Math.random() * (W.dmg[1] - W.dmg[0])) * (from && from.suspect ? 1 : L.dmg);
    if (v) {
      // the body takes most of it; what comes through the glass is yours
      if (this.fx) this.fx.sparks(ex, ey, ez, 3);
      v.damage(dmg * 0.6, true);
      // (an armoured vehicle, spec.armor -- the Wedge -- lets less through;
      // its body's share is scaled in Vehicle.damage)
      game.damagePlayer(dmg * 0.22 * (v.spec.armor || 1), 'gun');
      if (v.dead && game.onCarDestroyed) game.onCarDestroyed(v);
    } else game.damagePlayer(dmg, 'gun');
    return true;
  }
}

/**
 * A police helicopter: the hangar's Bell 407 (vehicles.js `heli`) in navy,
 * flown here rather than by updateHeli -- it circles you at ~64 m, turns its
 * nose to you, keeps its search point on you, and from three stars a
 * marksman (five a door gunner) shoots from it. It is not in traffic.cars:
 * nothing collides with it, and it costs its five draws.
 */
class Heli {
  constructor(pol, i) {
    const p = pol.player ? pol.player.position : { x: 0, y: 0, z: 0 };
    this.v = new Vehicle(pol.city, 'heli', 0x1a2433);
    this.v.setDetailed(true);   // the live rotors
    this.v.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    // The tail rotor is a few pixels 60 m up: not worth its draw. (The main
    // rotor stays: a still one reads as a model on a string.)
    for (const m of this.v.spinMeshes) if (m.userData.axis === 'x') m.visible = false;
    pol.scene.add(this.v.group);
    this.slot = i;
    // it arrives from 260 m off, already at height
    const a = Math.random() * Math.PI * 2;
    this.x = p.x + Math.cos(a) * 260; this.z = p.z + Math.sin(a) * 260;
    this.y = Math.max(p.y, G.terrainHeight(this.x, this.z)) + HELI_AGL + 30;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    this.ang = a + Math.PI * (i % 2);
    this.leaving = false; this.gone = false; this.sees = false;
    this.shootCd = 3 + Math.random() * 2; this.burst = 0; this.suspect = false;
    this.sweep = Math.random() * 6;
    this.aimX = p.x; this.aimZ = p.z; this.aimY = p.y;
  }

  update(dt, pol, L, player, v0) {
    const p = player.position, city = pol.city;
    this.sweep += dt;
    let tx, tz;
    if (this.leaving) {
      // climb away from you, and gone once well out of sight
      const away = Math.atan2(this.x - p.x, this.z - p.z);
      tx = this.x + Math.sin(away) * 300; tz = this.z + Math.cos(away) * 300;
      this.y += dt * 6;
      if (dist2(this.x, this.z, p.x, p.z) > 700 * 700) this.gone = true;
    } else {
      // Orbit your position (or the search's) with a lead on your velocity,
      // the two helicopters on opposite sides of the circle.
      this.ang += dt * 0.32;
      const R = 36 + this.slot * 14;
      let cx = pol.searching ? pol.lastX : p.x, cz = pol.searching ? pol.lastZ : p.z;
      if (!pol.searching && v0) { const f = v0.forward; cx += f.x * v0.vLong * 1.2; cz += f.z * v0.vLong * 1.2; }
      tx = cx + Math.cos(this.ang) * R; tz = cz + Math.sin(this.ang) * R;
    }
    // velocity toward the target, at a helicopter's acceleration and speed
    let wx = (tx - this.x) * 0.7, wz = (tz - this.z) * 0.7;
    const wl = Math.hypot(wx, wz);
    if (wl > HELI_SPEED) { wx *= HELI_SPEED / wl; wz *= HELI_SPEED / wl; }
    const ax = clamp(wx - this.vx, -HELI_ACC * dt, HELI_ACC * dt), az = clamp(wz - this.vz, -HELI_ACC * dt, HELI_ACC * dt);
    this.vx += ax; this.vz += az;
    this.x += this.vx * dt; this.z += this.vz * dt;
    if (!this.leaving) {
      const ground = Math.max(G.terrainHeight(this.x, this.z), G.terrainHeight(tx, tz), p.y);
      const ty = ground + HELI_AGL;
      this.y = lerp(this.y, ty, 1 - Math.exp(-0.8 * dt));
    }
    // the beam: on you while it sees you, sweeping round the search point
    // while it does not
    // (under a deck, it lights the deck: the beam cannot reach you)
    let bx = p.x, bz = p.z, by = pol.covered && !pol.searching ? Math.max(p.y, pol.coverTop) : p.y;
    if (pol.searching || this.leaving) {
      bx = pol.lastX + Math.cos(this.sweep * 0.7) * 28; bz = pol.lastZ + Math.sin(this.sweep * 0.9) * 28;
      by = city.groundAt(bx, bz, null);   // the top surface: a deck, not the ground under it
    }
    const k = 1 - Math.exp(-5 * dt);
    this.aimX = lerp(this.aimX, bx, k); this.aimZ = lerp(this.aimZ, bz, k); this.aimY = lerp(this.aimY, by, k);
    // can it see you? Not under a deck or in a bore; within range; and while
    // searching, only if the beam passes over you
    const dh = Math.hypot(p.x - this.x, p.z - this.z);
    this.sees = !this.leaving && !pol.covered && !pol.game.dead && dh < SEE_HELI
      && (dh < HELI_EYES || (!pol.searching && dh < SEE_HELI) || Math.hypot(p.x - this.aimX, p.z - this.aimZ) < HELI_SPOT);
    // nose to the target, banked into the acceleration
    const want = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
    this.yaw += clamp(angleWrap(want - this.yaw), -1.4 * dt, 1.4 * dt);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const aF = (ax * fx + az * fz) / Math.max(dt, 1e-3), aR = (ax * fz - az * fx) / Math.max(dt, 1e-3);
    const v = this.v;
    v.x = this.x; v.y = this.y; v.z = this.z; v.heading = this.yaw;
    v.pitch = lerp(v.pitch, clamp(aF * 0.02 + (this.vx * fx + this.vz * fz) * 0.004, -0.25, 0.25), 1 - Math.exp(-3 * dt));
    v.roll = lerp(v.roll, clamp(-aR * 0.025, -0.3, 0.3), 1 - Math.exp(-3 * dt));
    v.sync();
    v.spinParts(dt, 0, 34, 70);
    // the marksman or the door gunner
    if (L.heliGun && this.sees && !this.leaving) {
      pol.tickGun(this, WEAPONS[L.heliGun], dt, this.x + fz * 1.2, this.y - 0.3, this.z - fx * 1.2, true);
    } else if (this.burst === 0) this.shootCd = Math.max(this.shootCd - dt, 1);
  }

  dispose(scene) {
    scene.remove(this.v.group);
    this.v.bodyMat.dispose();
  }
}
