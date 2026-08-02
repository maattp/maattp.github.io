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
    v.mode = 'free';
    v.setDetailed(true);
    this.onFoot = false;
    this.h.group.visible = false;
    this.game.onEnterVehicle(v);
    return true;
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    const f = v.forward;
    const rx = f.z, rz = -f.x;
    let ox = v.x - rx * (v.halfWid + 1.1);
    let oz = v.z - rz * (v.halfWid + 1.1);
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
      }
    } else {
      this.y = lerp(this.y, ground, 1 - Math.exp(-16 * dt));
    }

    // Drowning is against the LOCAL water surface, not sea level.
    //
    // `y < -0.6` only ever describes the sea. Green Lake sits at 50 m and Lake
    // Union at 5, so you could stand on a lake bed indefinitely -- and
    // `world.waterLevelAt()`, written for exactly this, had no callers at all.
    const wl = this.world.waterLevelAt(this.x, this.z);
    if (wl !== null && G.isWater(this.x, this.z) && this.y < wl - 0.6) this.game.onDrown();

    animateWalk(this.h, clamp(this.speed * 0.16, 0, 0.85), dt, this.speed);
    this.h.group.position.set(this.x, this.y, this.z);
    this.h.group.rotation.y = this.heading;

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
    if (this.city.obstacleHit(x, z, 0.32)) return true;
    const near = this.city.buildingsNear(x, z, 6);
    for (const b of near) {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      // Below the base as well as above the roof: on foot in a bore under
      // downtown, the buildings overhead are not walls.
      if (Math.abs(lx) < b.w / 2 + 0.35 && Math.abs(lz) < b.d / 2 + 0.35
        && this.y < b.y + b.h - 0.5 && this.y > b.y - 2.5) return true;
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
    const wading = !v.spec.floats && wl !== null && G.isWater(v.x, v.z) && v.y < wl - 0.35;

    v.update(dt, {
      // A drowned engine makes no power and the wheels find nothing to push
      // against, which is what makes water read as water and not as a
      // differently-coloured road.
      throttle: wading ? 0 : throttle,
      brake, steer, handbrake: input.hand ? 1 : 0,
      // Planes read the stick's other axis: pull back (stick down, +y) to
      // climb, aviation-style. Cars ignore it.
      pitch: input.y || 0,
    });
    if (wading) {
      v.vLong -= v.vLong * Math.min(1, 2.6 * dt);
      v.vLat -= v.vLat * Math.min(1, 2.6 * dt);
    }
    // Scraping a wall is many frames of contact, not many crashes. Debounced
    // like vehicle-vehicle damage: unthrottled, holding the accelerator into a
    // building killed the player in about a sixth of a second.
    this.crashCd -= dt;
    // An airborne plane is not scraping along building WALLS -- the box test
    // is 2D and would wreck it against towers it is far above. Overflight is
    // handled by altitude; only a grounded plane collides like a vehicle.
    const airborne = v.spec.plane && v.airborne;
    const impact = airborne ? 0 : collideWithBuildings(v, this.city, (imp) => {
      if (this.crashCd > 0) return;
      this.crashCd = 0.4;
      this.game.onCrash(imp, false);
      if (imp > 8) this.game.damagePlayer(imp * 0.5, 'crash');
    });
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
    if (this.onFoot) {
      target.set(this.x, this.y, this.z);
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
      if (v.spec.plane) {
        // further back and higher, and the camera rides the CLIMB: keep some
        // of the vertical velocity in the look target so pulling up reads as
        // the horizon dropping, which is what flying looks like from a chase
        // camera.
        dist = 15.5 + clamp(sp * 0.05, 0, 3);
        height = 4.6 - clamp((v.vy || 0) * 0.18, -1.6, 1.6);
        lookH = 2.2 + clamp((v.vy || 0) * 0.22, -2, 2);
      }
      // ease the camera behind the car when driving forward
      if (v.vLong > 3) {
        const want = v.heading + Math.PI;
        const d = angleWrap(want - this.camYaw);
        this.camYaw += d * clamp(dt * 1.5 * clamp(sp / 12, 0, 1), 0, 0.25);
      }
    }
    const cp = Math.cos(this.camPitch);
    // Pull the camera in if a building sits between it and the player -- without
    // this you spend half of downtown looking at the inside of a wall.
    dist = this.clearCamDist(target, dist * cp, height) / Math.max(cp, 0.15);
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
    this.camPos.x = damp(this.camPos.x, wanted.x, rate, dt);
    this.camPos.y = damp(this.camPos.y, wanted.y, rateY, dt);
    this.camPos.z = damp(this.camPos.z, wanted.z, rate, dt);
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
    if (this.camPos.y < this.camFloor) this.camPos.y = this.camFloor;
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
    const deckAt = this.city.groundAt(target.x, target.z, target.y, 0);
    const ceil = deckAt + TUNNEL_H - 0.6;
    if (G.terrainHeight(this.camPos.x, this.camPos.z) > ceil && this.camPos.y > ceil) {
      this.camPos.y = ceil;
    }
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
    if (!near.length) return want;
    const camY = target.y + height;
    for (let d = 1.6; d <= want; d += 0.7) {
      const sx = target.x + ux * d, sz = target.z + uz * d;
      for (const b of near) {
        if (camY > b.y + b.h || camY < b.y - 3) continue;
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
