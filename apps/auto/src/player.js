// The player: on foot, behind the wheel, and the chase camera that follows.

import * as THREE from './three.js';
import { makeHumanoid, animateWalk } from './peds.js';
import { collideWithBuildings } from './traffic.js';
import { clamp, lerp, angleWrap, damp, dist2 } from './util.js';
import * as G from './geo.js';
import { TUNNEL_H } from './citygen.js';

export class Player {
  constructor(scene, city, game, world) {
    this.scene = scene;
    this.city = city;
    this.game = game;
    // Needed for `waterLevelAt`: drowning is against the local surface, and
    // the lakes are not at sea level.
    this.world = world;
    this.h = makeHumanoid({ seed: 1, unique: true, shirt: [0.16, 0.2, 0.3], pants: [0.12, 0.13, 0.17], hair: [0.1, 0.08, 0.07], scale: 1.03 });
    scene.add(this.h.group);
    this.x = G.SPAWN.x;
    this.z = G.SPAWN.z;
    this.y = city.groundAt(this.x, this.z, null);
    this.heading = G.SPAWN_HEADING;
    this.vy = 0;
    this.grounded = true;
    this.stuntCam = 0;   // 0..1, stunts.js: the chase camera pulls wide on a big jump
    this.speed = 0;
    this.onFoot = true;
    this.vehicle = null;
    this.health = 100;
    this.armed = false;
    this.ammo = 0;
    this.attackCd = 0;
    this.enterCd = 0;
    this.lift = 0;
    this.dead = false;
    this.crashCd = 0; // see updateDrive: one wall scrape is one crash
    this.scrapeT = 0; // seconds of wall contact left, for the scrape sound
    this.fellFrom = 0; // height a fall started at, for landing damage

    this.camYaw = this.heading + Math.PI;
    this.camPitch = 0.1;
    this.camDist = 6.5;
    this.camPos = new THREE.Vector3(this.x + Math.sin(this.camYaw) * 4.6, this.y + 1.6, this.z + Math.cos(this.camYaw) * 4.6);
    this.camLook = new THREE.Vector3(this.x, this.y + 1.4, this.z);
    this.camFloor = null; // smoothed floor for the camera clamp; see updateCamera
  }

  get position() {
    return this.onFoot ? { x: this.x, y: this.y, z: this.z } : { x: this.vehicle.x, y: this.vehicle.y, z: this.vehicle.z };
  }

  enterVehicle(v) {
    if (!v || v.dead) return false;
    this.vehicle = v;
    // Remember it was parked BEFORE the mode is overwritten. `game.onEnterVehicle`
    // tests `v.mode === 'parked' || v.wasParked` to decide whether this is theft
    // -- but mode is set to 'free' on the line below, and nothing in the repo
    // ever wrote `wasParked`, so taking a parked car has never added heat.
    v.wasParked = v.mode === 'parked';
    const wasMode = v.mode;
    v.mode = 'free';
    v.setDetailed(true);
    this.onFoot = false;
    this.h.group.visible = false;
    this.game.onEnterVehicle(v, wasMode);
    return true;
  }

  /**
   * Out of the vehicle. `force` (a wreck) always gets you out, wherever that
   * is; otherwise a BOAT (or a floatplane on the water) only lets you step
   * off onto something you can stand on -- a dock or the shore -- because
   * the kerb-side default puts you in the lake, and the lake drowns you.
   * Returns false when it refused.
   */
  exitVehicle(force = false) {
    const v = this.vehicle;
    if (!v) return false;
    const f = v.forward;
    const rx = f.z, rz = -f.x;
    let ox = v.x - rx * (v.halfWid + 1.1);
    let oz = v.z - rz * (v.halfWid + 1.1);
    if (v.spec.boat || v.spec.floats) {
      // Either beam, then over the bow and the stern, a little further out
      // each ring: the first spot that is not water (a platform deck counts,
      // groundAt answers it) and not inside a rail.
      let spot = null;
      for (const d of [1.1, 1.8, 2.6]) {
        for (const [ux, uz, e] of [[-rx, -rz, v.halfWid], [rx, rz, v.halfWid], [f.x, f.z, v.halfLen], [-f.x, -f.z, v.halfLen]]) {
          const x = v.x + ux * (e + d), z = v.z + uz * (e + d);
          const gy = this.city.groundAt(x, z, v.y + 1.5);
          const wl = this.world.waterLevelAt(x, z);
          if (wl !== null && gy < wl - 0.2) continue;
          if (this.city.obstacleHit(x, z, 0.3, gy)) continue;
          spot = [x, z];
          break;
        }
        if (spot) break;
      }
      if (!spot && !force) {
        this.game.onNoLanding && this.game.onNoLanding(v);
        return false;
      }
      if (spot) [ox, oz] = spot;
    }
    this.x = G.clampToMap(ox);
    this.z = G.clampToMap(oz);
    this.y = this.city.groundAt(this.x, this.z, v.y + 1.5);
    this.heading = v.heading;
    this.onFoot = true;
    this.h.group.visible = true;
    // Step out with the vertical state the car had, not whatever was left over
    // from before you got in -- jumping, entering and exiting used to launch you
    // upward on the stale `vy`.
    this.vy = 0;
    this.speed = 0;
    this.grounded = true;
    this.fellFrom = 0;
    v.mode = 'free';
    v.setDetailed(false);
    this.vehicle = null;
    this.game.onExitVehicle(v);
    return true;
  }

  update(dt, input, look, controls, traffic, peds) {
    this.attackCd -= dt;
    this.enterCd -= dt;

    this.camYaw -= look.x;
    this.camPitch = clamp(this.camPitch + look.y, -0.5, 1.15);

    if (this.onFoot) this.updateFoot(dt, input, traffic, peds);
    else this.updateDrive(dt, input, traffic, peds);

    const tap = controls.takeTap();
    if (tap === 'enter' && this.enterCd <= 0) {
      this.enterCd = 0.45;
      if (this.onFoot) {
        const v = traffic.nearestEnterable(this.x, this.z, 5.0);
        if (v) this.enterVehicle(v);
      } else this.exitVehicle();
    }

    if (input.attack && this.attackCd <= 0) this.attack(traffic, peds);
    this.updateCamera(dt, input);
  }

  updateFoot(dt, input, traffic, peds) {
    const mag = Math.hypot(input.x, input.y);
    // On-foot pace. The city is 10 km across, so these sit above real walking
    // and jogging speeds -- crossing a block should not be a chore.
    // 4.2 m/s is a 4:00/km jog and 7.5 is world-class sprinting -- at those
    // speeds the gait correctly came out looking like track athletics. The
    // character is a person moving around a city, so the speeds come down and
    // the pose follows: 3.6 is an easy run, 5.4 a hard one.
    // 3.6 / 5.4 was too slow to cross a city this size, and slowing the
    // character down was the wrong lever anyway: it was done to stop the gait
    // reading as track athletics, but the gait keys off runBlend and is judged
    // by tools/gait.mjs against published bands at 1.4 / 3.5 / 7.5 m/s -- all
    // of which it already passes. So the pose was never the speed's problem.
    // 5.0 is a purposeful run and 7.2 a sprint, which is about where a game of
    // this kind sits.
    const run = input.sprint ? 7.2 : 5.0;
    let target = 0;
    if (mag > 0.12) {
      // Stick is camera-relative. Note HEADING_SENSE: heading is three.js
      // rotation.y, so a LARGER heading turns anticlockwise = left on screen.
      // Pushing the stick right therefore has to subtract from the heading.
      const ang = Math.atan2(-input.x, -input.y) + this.camYaw + Math.PI;
      this.heading += clamp(angleWrap(ang - this.heading), -10 * dt, 10 * dt);
      target = run * clamp(mag, 0, 1);
    }
    this.speed = damp(this.speed, target, 9, dt);
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    // If we're already standing inside geometry -- put down in it, dumped out
    // of a car into it, knocked into it -- then refusing to move traps the
    // player permanently, walking on the spot with every direction blocked.
    // Clipping out is always better than being stuck, so let them walk.
    const stuck = this.blocked(this.x, this.z);
    if (stuck || !this.blocked(nx, nz)) {
      this.x = G.clampToMap(nx);
      this.z = G.clampToMap(nz);
    } else if (!this.blocked(nx, this.z)) this.x = G.clampToMap(nx);
    else if (!this.blocked(this.x, nz)) this.z = G.clampToMap(nz);

    // one paved-surface scan per frame, shared by the ground and camera queries
    this.lift = this.city.roadLift(this.x, this.z);
    const ground = this.city.groundAt(this.x, this.z, this.y + 1.2, this.lift);
    if (input.jump && this.grounded) {
      this.vy = 6.2;
      this.grounded = false;
    }
    // Walk off an edge and you FALL.
    //
    // `grounded` was only ever cleared by jumping, so stepping off a viaduct or
    // a sea wall eased you down on the same exponential the camera uses for
    // kerbs -- measured, dropped 25 m the player descended smoothly with
    // `grounded` still true the whole way. No arc, no fall, and nothing that
    // could ever cost you health. Anything more than a kerb below your feet is
    // air, and air is not something you stand on.
    const KERB = 0.45;
    if (this.grounded && this.y - ground > KERB) {
      this.grounded = false;
      this.vy = 0;
      this.fellFrom = this.y;
    }
    if (!this.grounded) {
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        // Landing. Below about four metres a person absorbs it; past that it
        // hurts, and it scales with the square of the drop the way the energy
        // does.
        const drop = (this.fellFrom || this.y) - ground;
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        this.fellFrom = 0;
        if (drop > 4.5) this.game.damagePlayer(Math.min(100, (drop - 4.5) ** 1.6 * 1.6), 'fall');
        if (drop > 1.2 && this.game.onLand) this.game.onLand(drop);
      }
    } else {
      // ON the ground, not easing toward it. The ease (rate 16) trailed the
      // surface on every rise: measured walking up a Queen Anne street the feet
      // ran 21 cm INTO the road (p10), 30 cm at worst, and every kerb stepped
      // up through 17 cm of pavement -- the "sinking" when walking. The camera
      // keeps its own smoothed height (camFootY), so kerbs still don't jolt it.
      this.y = ground;
    }
    this.camFootY = this.camFootY == null || Math.abs(this.camFootY - this.y) > 3
      ? this.y : damp(this.camFootY, this.y, 14, dt);

    // Drowning is against the LOCAL water surface, not sea level.
    //
    // `y < -0.6` only ever describes the sea. Green Lake sits at 50 m and Lake
    // Union at 5, so you could stand on a lake bed indefinitely -- and
    // `world.waterLevelAt()`, written for exactly this, had no callers at all.
    const wl = this.world.waterLevelAt(this.x, this.z);
    if (wl !== null && G.isWater(this.x, this.z) && this.y < wl - 0.6) this.game.onDrown();

    // Root first: animateWalk locks planted feet in world space (see peds.js).
    this.h.group.position.set(this.x, this.y, this.z);
    this.h.group.rotation.y = this.heading;
    animateWalk(this.h, clamp(this.speed * 0.16, 0, 0.85), dt, this.speed);

    // run over by a car
    for (const v of traffic.cars) {
      if (v.mode === 'parked' || Math.abs(v.vLong) < 3) continue;
      const n = v.nearest(this.x, this.z);
      if (dist2(n.x, n.z, this.x, this.z) < 0.8) {
        this.game.damagePlayer(Math.abs(v.vLong) * 1.6, 'vehicle');
        this.x -= v.forward.x * 1.4;
        this.z -= v.forward.z * 1.4;
      }
    }
  }

  blocked(x, z) {
    // Trunks and poles. `blocked` is tried on each axis separately by the
    // caller, so a circle here lets you slide around a tree rather than
    // sticking to it.
    if (this.city.obstacleHit(x, z, 0.32, this.y)) return true;
    const near = this.city.buildingsNear(x, z, 6);
    for (const b of near) {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      // Below the base as well as above the roof: on foot in a bore under
      // downtown, the buildings overhead are not walls. "Below" is judged
      // against the ground under the PLAYER -- b.y is the footprint centroid's
      // terrain, and a big box on a grade drops metres from centroid to corner.
      if (Math.abs(lx) < b.w / 2 + 0.35 && Math.abs(lz) < b.d / 2 + 0.35
        && this.y < b.y + b.h - 0.5
        && G.terrainRaw(x, z) - this.y < 2.5) return true;
    }
    return false;
  }

  updateDrive(dt, input, traffic, peds) {
    const v = this.vehicle;
    if (!v) { this.onFoot = true; this.h.group.visible = true; return; }
    const steer = -input.x; // HEADING_SENSE: +steer raises heading, which is a left turn
    // Analogue where the input is analogue. vehicles.js has always taken a
    // continuous throttle; a trigger just stops throwing away the resolution,
    // which is most of what makes a pad feel different from a touch button.
    const throttle = input.gasAmt != null ? input.gasAmt : (input.gas ? 1 : 0);
    const brake = input.brakeAmt != null ? input.brakeAmt : (input.brake ? 1 : 0);

    // Water is against the LOCAL surface, the same law the on-foot path above
    // already follows -- and this was the one place that never learned it. The
    // test used to be `v.y < -1.2 && G.isWater(...)`, which only ever describes
    // the sea: with Green Lake at 50.3 m and Lake Union at 5, a car on a lake
    // bed never came close to tripping it, so you could drive the bottom of
    // Green Lake at 200 km/h, dry and at full throttle.
    //
    // Sampled before the step, so an engine that has drowned cannot make power
    // for the frame that put it under.
    // BOTH tests, and the mask is the one that says whether this is water.
    // waterLevelAt answers over a lake's axis-aligned BOUNDING BOX, so inside
    // Green Lake's rectangle it reports 50.3 m for the dry park ringing it --
    // the trap this file's own notes describe, which once deleted 105 real
    // trees. Height alone would cut the engine on a street that happens to dip
    // below the lake beside it. The level is a reference height, not a region.
    const wl = this.world.waterLevelAt(v.x, v.z);
    // A floatplane's pontoons make water a surface, not a hazard.
    const wading = !v.spec.floats && !v.spec.boat && wl !== null && G.isWater(v.x, v.z) && v.y < wl - 0.35;

    v.update(dt, {
      // A drowned engine makes no power and the wheels find nothing to push
      // against, which is what makes water read as water and not as a
      // differently-coloured road.
      throttle: wading ? 0 : throttle,
      brake, steer, handbrake: input.hand ? 1 : 0,
      // Planes read the stick's other axis: pull back (stick down, +y) to
      // climb, aviation-style. Cars ignore it.
      pitch: input.y || 0,
      // A helicopter's collective: GAS / BRAKE on touch (relabelled UP /
      // DOWN), the triggers on a pad, Q / Z on a keyboard -- whose W and S
      // are already the stick. `pilot` spools the rotor.
      lift: input.liftAmt != null ? input.liftAmt : throttle,
      sink: input.sinkAmt != null ? input.sinkAmt : brake,
      pilot: true,
    });
    if (wading) {
      v.vLong -= v.vLong * Math.min(1, 2.6 * dt);
      v.vLat -= v.vLat * Math.min(1, 2.6 * dt);
    }
    // Scraping a wall is many frames of contact, not many crashes. Debounced
    // like vehicle-vehicle damage: unthrottled, holding the accelerator into a
    // building killed the player in about a sixth of a second.
    this.crashCd -= dt;
    this.scrapeT -= dt;
    // An airborne plane is not scraping along building WALLS -- the box test
    // is 2D and would wreck it against towers it is far above. Overflight is
    // handled by altitude; only a grounded plane collides like a vehicle.
    // A helicopter always collides: it hovers among the towers at walking
    // pace, and the test already frees anything above a roof.
    const airborne = v.spec.plane && v.airborne && !v.spec.heli;
    const impact = airborne ? 0 : collideWithBuildings(v, this.city, (imp) => {
      if (this.crashCd > 0) return;
      this.crashCd = 0.4;
      this.game.onCrash(imp, false);
      if (imp > 8) this.game.damagePlayer(imp * 0.5, 'crash');
    });
    // A boat's shore is its wall: updateBoat refuses the move and leaves the
    // impact, which is a crash like any other.
    if (v.spec.boat && v.shoreHit > 3 && this.crashCd <= 0) {
      this.crashCd = 0.4;
      this.game.onCrash(v.shoreHit, false);
      if (v.shoreHit > 9) this.game.damagePlayer(v.shoreHit * 0.4, 'crash');
    }
    // Contact, held briefly: the grinding loop follows it (see audio.js).
    if (impact > 0 || (v.spec.boat && v.shoreHit > 0)) this.scrapeT = 0.15;
    // Deep enough to be over the roof rather than merely through a ford. One
    // test now, against the local surface, instead of a separate sea-only path.
    if (wading && v.y < wl - 1.6) this.game.onCarSank(v);
    if (v.dead) this.game.onCarDestroyed(v);
  }

  attack(traffic, peds) {
    if (this.onFoot) {
      if (this.armed && this.ammo > 0) {
        this.attackCd = 0.22;
        this.ammo--;
        const dir = { x: -Math.sin(this.camYaw), z: -Math.cos(this.camYaw) };
        this.heading = this.camYaw + Math.PI;
        this.game.onGunshot(this.x, this.y + 1.4, this.z, dir);
        // hitscan against peds and cars
        for (let t = 2; t < 60; t += 1.2) {
          const hx = this.x + dir.x * t, hz = this.z + dir.z * t;
          const p = peds.hitAt(hx, hz, 0.9, 34, true);
          if (p) return;
          for (const v of traffic.cars) {
            if (dist2(v.x, v.z, hx, hz) < v.radius * v.radius) {
              v.damage(9, true);
              this.game.onShotVehicle(v, hx, hz);
              return;
            }
          }
        }
      } else {
        this.attackCd = 0.5;
        this.game.onPunch();
        const fx = this.x + Math.sin(this.heading) * 1.2;
        const fz = this.z + Math.cos(this.heading) * 1.2;
        peds.hitAt(fx, fz, 1.1, 18, true);
      }
    } else {
      this.attackCd = 0.4;
      this.game.onHorn();
    }
  }

  updateCamera(dt, input) {
    const target = new THREE.Vector3();
    let dist, height, lookH;
    // A plane's rig is RIGID IN TRANSLATION: the boom and look offsets are
    // damped, the plane's own motion is followed exactly. Damping the world
    // position instead leaves the camera trailing the plane, and how far
    // depends on dt: at 116 m/s and a rate of 9 the lag is 12.0 m on a 16 ms
    // frame and 9.7 m on a 60 ms hitch. A phone streaming chunks does not hold
    // an even clock, so the boom surged in and out by metres with every hitch,
    // which from the seat reads as the camera jumping about.
    const plane = !this.onFoot && this.vehicle.spec.plane;
    this.camClamp = null;
    if (this.onFoot) {
      target.set(this.x, this.camFootY != null ? this.camFootY : this.y, this.z);
      dist = 4.6;
      height = 1.55;
      lookH = 1.45;
    } else {
      const v = this.vehicle;
      target.set(v.x, v.y, v.z);
      const sp = Math.abs(v.vLong);
      dist = 7.6 + v.spec.len * 0.42 + clamp(sp * 0.09, 0, 3.4);
      height = 3.2 + v.spec.roof * 0.42;
      lookH = 1.05;
      if (v.spec.heli) {
        // Closer than a plane's -- a helicopter is flown at a hover and at
        // walking pace as often as flat out, and from 15 m back at a hover it
        // is a speck -- lengthening with speed. The look point stays on the
        // cabin, with a little of the climb in it like the planes'.
        dist = 12.5 + clamp(sp * 0.07, 0, 4.5);
        height = 3.4 - clamp((v.vy || 0) * 0.10, -1, 1);
        lookH = 1.7 + clamp((v.vy || 0) * 0.12, -1, 1);
      } else if (v.spec.plane) {
        // further back and higher, and the camera rides the CLIMB: keep some
        // of the vertical velocity in the look target so pulling up reads as
        // the horizon dropping, which is what flying looks like from a chase
        // camera.
        dist = 15.5 + clamp(sp * 0.05, 0, 3);
        height = 4.6 - clamp((v.vy || 0) * 0.18, -1.6, 1.6);
        lookH = 2.2 + clamp((v.vy || 0) * 0.22, -2, 2);
      }
      // A big stunt jump pulls the boom back and up a little, eased by
      // stunts.js, so the landing zone comes into view before you reach it.
      if (this.stuntCam > 0.001) { dist += 4.5 * this.stuntCam; height += 1.8 * this.stuntCam; }
      if (v.spec.heli && v.airborne && v.vLong > -2) {
        // A helicopter yaws on the spot, and the stick flies it along the
        // nose, so the camera has to come round behind a pedal turn at the
        // hover as well -- or "forward" stops meaning up the screen. Slower
        // at the hover (a turn reads as a turn), tighter with speed.
        const d = angleWrap(v.heading + Math.PI - this.camYaw);
        this.camYaw += d * clamp(dt * (1.1 + 1.4 * clamp(sp / 20, 0, 1)), 0, 0.25);
      } else if (v.vLong > 3) {
        // ease the camera behind the car when driving forward
        const want = v.heading + Math.PI;
        const d = angleWrap(want - this.camYaw);
        this.camYaw += d * clamp(dt * 1.5 * clamp(sp / 12, 0, 1), 0, 0.25);
      }
    }
    const cp = Math.cos(this.camPitch);
    // Pull the camera in if a building sits between it and the player -- without
    // this you spend half of downtown looking at the inside of a wall.
    //
    // Not for a plane in the air. Measured on a low pass over First Hill the
    // boom snapped from 17 m to 1.5 m and back as each tower went by, 24 frames
    // at a time -- a plane at 110 m/s passes a tower in a fraction of a second,
    // so clipping one briefly is far less violent than slamming the camera into
    // the tailplane. On the ground a plane taxis like a car and keeps the pull.
    // A helicopter keeps the pull-in below 25 m/s: at a hover beside a tower
    // the boom otherwise sits inside it, and the rigid rig below damps the
    // change in boom length anyway.
    const airPlane = plane && this.vehicle.airborne && !(this.vehicle.spec.heli && this.vehicle.speed < 25);
    if (!airPlane) dist = this.clearCamDist(target, dist * cp, height) / Math.max(cp, 0.15);
    const wanted = new THREE.Vector3(
      target.x + Math.sin(this.camYaw) * dist * cp,
      target.y + height + Math.sin(this.camPitch) * dist,
      target.z + Math.cos(this.camYaw) * dist * cp
    );
    const rate = this.onFoot ? 14 : 9;
    // Vertical follows far slower than horizontal. The ground under a walking
    // player is a staircase -- 22 cm off a kerb, another step across a junction
    // -- and a camera tracking it at the horizontal rate reproduces every one of
    // those as a jolt. Horizontal has to stay tight or the camera feels loose,
    // so the two rates are deliberately different.
    const rateY = this.onFoot ? 4.5 : 7;
    if (plane) {
      // Damp the OFFSET, follow the plane. See the note at the top.
      if (!this.camRel) this.camRel = new THREE.Vector3().subVectors(this.camPos, target);
      this.camRel.x = damp(this.camRel.x, wanted.x - target.x, rate, dt);
      this.camRel.y = damp(this.camRel.y, wanted.y - target.y, rateY, dt);
      this.camRel.z = damp(this.camRel.z, wanted.z - target.z, rate, dt);
      this.camPos.addVectors(target, this.camRel);
    } else {
      this.camRel = null;
      this.camPos.x = damp(this.camPos.x, wanted.x, rate, dt);
      this.camPos.y = damp(this.camPos.y, wanted.y, rateY, dt);
      this.camPos.z = damp(this.camPos.z, wanted.z, rate, dt);
    }
    // Keep the camera out of the ground, but clamp against a SMOOTHED floor.
    // The raw surface is discontinuous, so clamping straight to it turns every
    // kerb the camera passes over into a snap of its own. It doesn't need 22 cm
    // of kerb accuracy either, hence the zero lift.
    //
    // ASK FOR THE FLOOR THE PLAYER IS ON, not the highest one. `groundAt` with
    // no reference height returns the HIGHEST deck at that point, which is the
    // right answer for a spawn and completely wrong here: inside a bore the
    // highest deck is the street overhead. Measured 150 m into the SR-99 tunnel
    // -- deck 7.1, roof 12.5, ground above 31.5 -- the camera's floor came back
    // as 31.5 and the clamp shoved the camera 20 m up through the roof and out
    // onto the surface. Passing the target's height picks the deck the player
    // is actually driving on.
    const rawFloor = this.city.groundAt(this.camPos.x, this.camPos.z, target.y, 0) + 1.1;
    this.camFloor = this.camFloor == null ? rawFloor : damp(this.camFloor, rawFloor, 8, dt);
    if (this.camPos.y < this.camFloor) { this.camPos.y = this.camFloor; this.camClamp = 'floor'; }
    // AND UNDER THE CEILING. Nothing else stops it: clearCamDist only tests
    // buildings, so a bore's walls and roof are invisible to the boom, and the
    // rig rides 3.2 + roof*0.42 above the car plus sin(pitch)*dist -- looking
    // up 15 deg adds about 3 m, which is more headroom than a 5.4 m bore has.
    // Only clamp where there really is ground overhead, so an open road is
    // untouched.
    // Measured off the TARGET's deck, not the damped camera floor. camFloor
    // lags by design -- that is what stops kerbs snapping the camera -- so a
    // ceiling derived from it lags too, and the camera was still coming
    // through the roof on 2 of 24 stations while the lag caught up.
    //
    // ONLY WHERE THE TARGET IS REALLY IN A BORE. "Ground above the camera is
    // higher than a bore roof over the target's deck" is also true of any
    // hillside behind a plane: for a plane 150 m up, `deckAt` is the terrain
    // under it, so wherever the ground 17 m back stood 4.8 m higher the camera
    // was put back on the hillside -- measured on the Boeing Field route, 246
    // clamped frames in 12 bursts, the camera up to 187 m below the plane and
    // 159 m of jump in a single frame, then springing back at 9 m a frame.
    // A bore has ground over the TARGET and the target on its
    // deck; both are asked. The hold carries the clamp ~1 s past the mouth on
    // the way out, while the boom is still inside with the car already clear.
    const deckAt = this.city.groundAt(target.x, target.z, target.y, 0);
    const ceil = deckAt + TUNNEL_H - 0.6;
    const inBore = target.y - deckAt < 2.5 && (G.terrainHeight(target.x, target.z) > deckAt + TUNNEL_H * 0.5
      || (this.city.camBlockOver && this.city.camBlockOver(target.x, target.z, deckAt)));
    this.camBoreHold = inBore ? 1 : Math.max(0, (this.camBoreHold || 0) - dt);
    // RAW ground over the camera, not the carved: at a mouth the camera is
    // over the cutting's dug end, where the carved ground is low but the
    // headwall and its top slab stand -- the carved test let it rise into them
    // with the car 15 m inside (the view went black).
    if (this.camBoreHold > 0 && target.y - deckAt < 2.5
      && G.terrainRaw(this.camPos.x, this.camPos.z) > ceil && this.camPos.y > ceil) {
      this.camPos.y = ceil;
      this.camClamp = 'ceil';
    }
    if (plane) {
      // Clamps are real positions, so the next frame damps from where the
      // camera actually ended up rather than from where it wanted to be.
      this.camRel.subVectors(this.camPos, target);
      // The look point rides the plane too; only its height offset is damped.
      if (!this.camLookRel) this.camLookRel = new THREE.Vector3().subVectors(this.camLook, target);
      this.camLookRel.x = damp(this.camLookRel.x, 0, 16, dt);
      this.camLookRel.y = damp(this.camLookRel.y, lookH, 12, dt);
      this.camLookRel.z = damp(this.camLookRel.z, 0, 16, dt);
      this.camLook.addVectors(target, this.camLookRel);
      return;
    }
    this.camLookRel = null;
    this.camLook.set(
      damp(this.camLook.x, target.x, 16, dt),
      damp(this.camLook.y, target.y + lookH, this.onFoot ? 6 : 12, dt),
      damp(this.camLook.z, target.z, 16, dt)
    );
  }

  /** Longest horizontal boom length behind the target that stays out of geometry. */
  clearCamDist(target, want, height) {
    const ux = Math.sin(this.camYaw), uz = Math.cos(this.camYaw);
    const near = this.city.buildingsNear(target.x, target.z, want + 8);
    const nb = near.length;
    // ...and portal walls (world._camBlock): the same boxes, but tested on
    // their exact height band -- a camera in the bore passes under a lintel
    const pg = this.city.camBlockGrid;
    if (pg) {
      const r = want + 8, seen = new Set();
      for (let cx = Math.floor((target.x - r) / 32); cx <= Math.floor((target.x + r) / 32); cx++) {
        for (let cz = Math.floor((target.z - r) / 32); cz <= Math.floor((target.z + r) / 32); cz++) {
          const l = pg.get(cx * 100003 + cz);
          if (l) for (const b of l) if (!seen.has(b)) { seen.add(b); near.push(b); }
        }
      }
    }
    if (!near.length) return want;
    const camY = target.y + height;
    for (let d = 1.6; d <= want; d += 0.7) {
      const sx = target.x + ux * d, sz = target.z + uz * d;
      for (let bi = 0; bi < near.length; bi++) {
        const b = near[bi];
        if (camY > b.y + b.h || camY < b.y - (bi < nb ? 3 : 0.3)) continue;
        // a mouth card stops the boom only with the target inside the bore
        if (b.card && (target.x - b.x) * b.card[0] + (target.z - b.z) * b.card[1] <= 0) continue;
        const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
        const dx = sx - b.x, dz = sz - b.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < b.w / 2 + 0.5 && Math.abs(lz) < b.d / 2 + 0.5) {
          return Math.max(1.5, d - 0.9);
        }
      }
    }
    return want;
  }

  applyCamera(camera) {
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
  }

  respawn(x, z) {
    if (this.vehicle) {
      this.vehicle.mode = 'free';
      this.vehicle = null;
    }
    this.onFoot = true;
    this.h.group.visible = true;
    this.x = x;
    this.z = z;
    this.y = this.city.groundAt(x, z, null);
    this.vy = 0;
    this.speed = 0;
    this.health = 100;
    this.dead = false;
    this.camPos.set(x + Math.sin(this.camYaw) * 4.6, this.y + 1.6, z + Math.cos(this.camYaw) * 4.6);
  }
}
