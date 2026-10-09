# Auto: Vehicles and flying

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Vehicles

**A collision lasts many frames — damage it once.** The contact pair stays
overlapping and closing for several frames and the damage call ran on every one,
so a 20 m/s shunt cost 14 health per frame and destroyed a 100-health car in
about an eighth of a second. Any real impact detonated on contact.
`Vehicle.hitCd` debounces it; scripted damage (gunfire) passes `force` and
bypasses it. `collideWithBuildings` had the identical shape of bug on the player
side — holding the throttle into a wall killed the player in about a sixth of a
second — and `player.crashCd` does the same job there. **Anything driven by
sustained contact needs this**; per-frame is never the right cadence for it.

**Nobody at the wheel: the parking brake** (v142). traffic.js gives every
unattended vehicle -- an 'apron' car or quad, one you got out of ('free') --
the input `{ park: true }`, and `Vehicle.update` then takes up to 9 m/s^2 of
speed off it a second (2.5 above 4 m/s, so a car bailed out of at speed
coasts to a stop first). It used to get `brake: 0.12`, and **at a standstill
the brake is reverse gear**: every parked car crept backwards (the spawn's
sports car 33 m in 10 s) and on a hill gravity took over (16-20 m in 8 s on
a 35 % grade). Aircraft and boats keep their old coast. verify's "parked
cars" section.

**A scrape is not a crash.** `collideWithBuildings`' obstacle/barrier branch
(every vehicle, player and traffic) took 80 % of the speed on every contact
frame whatever the angle, so a vehicle grazing a wall side-on lost it each
frame it stayed in touch and wedged at full throttle — a bus on SR-99's upper
deck, its 4.3 m collision circle touching the bore wall, stopped dead with a
column queued behind it. The loss now scales with the angle: `glance =
clamp(-along / 0.3, 0, 1)`, `vLong *= 1 - 0.8 * glance`. Head-on (~17 deg or
more into it) keeps the full loss, a pure side contact keeps all its speed.

**A car follows the ground DOWN a hill; it does not fall down it** (v201). The
vertical follow is an 18/s exponential toward the four-wheel average, and a
body more than 0.25 m over that average is airborne. Going down a 20 % street
at 24 m/s the floor drops 5 m/s, the exponential lags it by 5/18 = 0.3 m, and
the car was "airborne" -- falling from `vy = 0` while the road ran off, then
landing with a snap: SW Genesee St (-23 %) 40 of 136 frames in the air, 18
take-offs, 60 frames over 30 m/s^2, peaks of 790. Same path for every wheeled
type (cars, AI traffic, bikes, quad: one `Vehicle.update`), so the fix is one
place, in the vertical block of `updateDrive`'s tail: the follow is **fed
forward** with the floor's steady descent. `floorVy` is a ~0.12 s average of the
floor's own motion; under 1.5 m/s of it (a 0.08 m lag) the follow is left alone
-- most of the city, where feeding forward only passed the floor's noise
through (a full feed-forward: acc>30 +27 % city-wide) -- and only the rate above
that is fed, so a steep street is held about 0.08 m behind its floor, nowhere
near the 0.25 m that means airborne. The feed fades out when the floor's rate
this frame disagrees with the average by 1-3 m/s, which is exactly what the far
side of a crest does: there the old lag rule runs untouched and the car takes
off with the hang it always had. **A steady grade is a slope, a crest is a
jump.** A fall that starts leaves with the descent the follow was riding, not
from rest.

Two things were tried and are wrong, so do not rebuild them. A *ballistic*
take-off test (integrate a free-falling body against the floor, carry the
climb the car arrives with) is physically lovely and gave a bus a quarter of
master's crest hang, a pickup half, and -- because "the climb" was read off the
follow's own catch-up -- launched cars off every freeway data bump (a floor
that steps up 0.5-1 m on I-5 / Aurora / SR-99) and off a teleport. And the
climb has no business in the test at all: what the car did to reach the floor
is not the floor's velocity.

A STEP in the floor (>0.25 m in a frame: a deck taken or lost, a pier end, a
teleport) and anything on a stunt ramp (`rampRef`) keep the plain 0.25 m rule,
so a bridge-deck end, a pier and the `rampVy` lip launch are untouched. Verify
with `node tools/hillride.mjs [--types sedan,pickup,bus,...] [--trace]`: the
steepest streets must give <= 2 air flips and <= 5 frames over 30 m/s^2, the
sharp 32/-27 % crest at (-434, -1467) must still hang >= 24 frames (master 32,
sedan 1.1 m up; the 18/-3 % data cliff leaves on any build and proves nothing),
freeway step sites may not launch more than master does, a made-up 0.7 m step
up in a flat street may not launch, and a car dropped 2 m under Genesee's floor
may not fly. The crest table prints every type. **Crest hang is the one number
here that is chaotic**: the same crest lands on a -27 % slope at 9 m/s of
descent, beyond what the feed-forward holds, so a second hop of ~20 frames
comes and goes with the vehicle's wheelbase (a sedan 42 frames, a hatch 26 --
the first flight, height and landing speed, are the same). Compare heights.
`ridesurvey` carries a replica of the follow (`--legacy` gives the old one) --
trust it for acc>30 / acc>60 and the ranking, not for air frames on freeway
kinds, which it overstates.

**The electric car is a spec flag, not a special case.** `ev: true` in `TYPES`
switches four things: a sealed nose with one full-width light bar at each end
instead of a grille and paired lamps, a square-root torque falloff instead of a
linear one (an electric motor is at full torque from zero, so it leaps off the
line and runs out of road rather than out of revs), regen at 4.6 m/s² off
throttle against 2.4, and more grip, because the battery floor puts the mass
under the axle line. In `audio.js` the same flag picks the `ev` engine profile
(motor tone tracking road speed plus inverter whine, no gears); see "Sound".

**An open car needs the deck OPENED, not an interior laid under it.** There is
no boolean here, so `bodyCore`'s section closes across the top at the beltline
and any interior built below that is simply hidden by it -- seats, dash and
wheel all present and none of them visible. `deckDip` sinks the two innermost
section points to a floor height instead, so the loft itself dives into a tub.
The trim over it is a separate `patch` on those same points because `loft`
forces every normal outward from the ring centre, and the inside of a tub faces
the other way. And in a dark tub, contrast is the whole game: the steering
wheel was there for two renders before it was moved into `trim` in a bright
colour and became visible.

**Steering asks for a radius the tyres can actually hold.** The lock used to
come from a fixed curve -- a target radius lerped 4.5 -> 11 m across the speed
range -- and that is not a grip limit, it is a shape. At 122 km/h it asked a
sedan for an 11 m radius, which is **10.7 g** of lateral acceleration against
the **1.9 g** its tyres have: a demand 5.5x over the limit, and rising with
speed. The block that applies the yaw states that the steering limit IS the grip
limit ("with steering limited to what grip supports, the yaw the car achieves IS
the lateral acceleration"), so with a radius like that the statement was untrue
and *nothing anywhere enforced grip*. The car pivoted on rails at a rate no tyre
could produce. That is what wild high-speed steering was.

`r = v^2 / a` is the whole fix, with `STEER_BITE` just over 1 so a bend taken
flat out is at the limit with a little left to provoke. Measured, sedan:

| | 20 kph | 40 | 60 | 90 | 120 |
|---|---|---|---|---|---|
| radius before | 5.5 m | 6.6 | 7.7 | 9.3 | 10.9 |
| radius after | 4.5 m | 5.2 | 11.7 | 26.3 | 46.8 |
| lateral g before | 0.57 | 1.91 | 3.69 | 6.87 | **10.42** |
| lateral g after | 0.71 | 2.43 | 2.43 | 2.42 | **2.42** |

Low-speed lock is unchanged -- below about 34 km/h a fixed floor applies, so
parking-lot agility is exactly as tight as it was.

**Braking is scaled with grip, not left honest.** The throttle ran at
`ARCADE_PUNCH` 2.4x and cornering at `ARCADE_GRIP` 2.2x while braking sat at
exactly 1.0x, and the comment above them claimed braking "stays honest" as
though that were a decision rather than the one axis nobody had revisited. It is
why braking felt slow: you accelerated at 2.4x and stopped at 1x. `ARCADE_BRAKE`
matches `ARCADE_GRIP`, which also keeps the tyre isotropic. 100-0 went 39.3 m ->
18.4 m. **`tools/vehicles.mjs` divides the brake band by it**, exactly as it
already divided the accel band by `ARCADE_PUNCH`.

**And its class-order check compares lateral g DIRECTLY now.** It used to
multiply by the wheelbase, and had to: with a fixed-radius lock, lat came out as
`v^2 tan(steer) / L` and geometry had to be divided back out before grip was
visible. Solving the lock from grip makes lat independent of wheelbase, so that
multiply stopped removing a bias and started adding one -- it reported a
short-wheelbase sports car as cornering worse than a pickup it out-corners by
0.7 g. **Normalise for the model you have, not the one the check was written
against.**

**A bike leans into the corner, and the sign is the same trap as the camber.**
`tan(lean) = lateral acceleration / g`, and it is built from the acceleration
the tyres are actually delivering -- the demand *before* the friction circle
limits it would lay the bike flat at a speed it cannot hold anyway. Because
`rotation.z` raises local +X and a positive yaw rate turns the vehicle toward
+X, leaning IN is a *negative* roll. Verify it by driving a circle and reading
`v.tilt.rotation.z` against the sign of the heading change; a bike leaning out
of its corners is unmissable and the arithmetic looks right either way.

**The rider is the pedestrian humanoid, posed.** `makeRider` in vehicles.js
takes `makeHumanoid` with a shared geometry and sets bone rotations from the
`RIDERS` table: one SkinnedMesh, one draw call, and it inherits every fix to
the character body. The bones hang down -Y, so **+x on a limb bone swings it
backward** and +x on the spine leans the torso forward. The reach is the
constraint that matters: shoulder to grip is about 64 cm on this humanoid, so
the bars are placed where the hands land, not the other way round.

**Wheel wells are capped at the shoulder line.** The well is sized off
`wheelR` and the bodywork off `belt`, so a big wheel under a low body pushed a
black slab up through the top of each wing — two per side. It looked like
broken geometry and it was on the sports car as well as the first pass at the
EV. Don't diagnose this from a render: raycast the offending pixel and read
back which builder it came from (`paint` / `trim` / `matte`) and the hit point
in the car's local frame. That turns "some dark box" into "matte, at
(0.71, 0.87, 1.66)", which is one arithmetic step from the line that drew it.
Remember `scene.updateMatrixWorld(true)` first, or every ray misses.

**Steer outside the spin.** A wheel carries a roll on X and a steer on Y, and
Euler order decides which is applied in whose frame. The default `XYZ` builds
`Rx·Ry`: the wheel is steered and then rolled about the *car's* X axis rather
than its own axle, so a turned front wheel tumbles instead of rolling — the axle
tilts off horizontal by `asin(sin(steer)·sin(spin))`, about 30° at half lock.
That is the wheel wobble. `rotation.order = 'YXZ'` gives `Ry·Rx`: roll on the
axle, then steer the lot.

### The Wedge: fast, tough, stainless

**An angular stainless electric pickup** (`wedge`, `buildWedge`), original
and unbranded: one straight roofline from the nose over the cabin to a
matte bed cover, flat steel facets meeting at sharp creases, flush glass,
a full-width light bar at each end, angular black-flared arches over chunky
tyres with flat aero covers (`addWheel`'s `kind` 'aero'). `docs/wedge/` has
shots.

- **Built facet by facet, not lofted.** `bodyCore`'s smooth normals would
  round off every crease, which is the whole shape. `wFacet` emits one planar
  polygon with its own Newell normal. The body hangs off four straight lines
  -- the roofline `top(z)`, a horizontal `BELT` crease, the section `xs(y)`
  (lower sides lean out to the belt, upper sides lean in to the roof edge)
  and `sill(z)` -- and each flank is ONE plane (x depends on y alone), so any
  quad with corners on it is planar wherever the stations fall. The roof is
  narrowest at the apex and widens to the full body at both ends without a
  single extra station. 2.8k triangles a traffic instance, under half a
  sedan's; 3 draws, glass in `trim` as everywhere.
- **Paint ignores vertex colour** (`paintMaterial` has no `vertexColors`), so
  tones per facet do nothing; the facets read from their normals alone.
  `spec.finish: 'steel'` gives brushed stainless (metalness 0.92, roughness
  0.30, clearcoat 0.12). The clearcoat stays above zero on purpose: it is a
  define, so the steel compiles the same program as every painted car and
  the first Wedge round a corner is no hitch. `livery` keeps it stainless.
- **The back of a panel is culled**, and with see-through glass on both sides
  and a glass roof, a B-pillar seen across the cabin through the far window
  was a hole. `wFacet`'s `liner` adds an inward copy in `matte` for the panels
  beside the cabin.
- **Tough is two spec fields.** `hp` is its health (250; every other vehicle
  starts at 100) and `armor` (0.5) scales every hit in `Vehicle.damage` --
  collisions, gunfire, landings -- and the wall-crash and police-gunfire
  damage to whoever is inside (player.js, main.js `onCopShot`). The smoke
  threshold is 45 % of `hp`, not 45. `mass` 2.6 shoves traffic aside.
  Measured at fixed dt (flat ground, the real `Vehicle.update` +
  `resolveCarCollisions`):

  | | sedan | Wedge |
  |---|---|---|
  | side-on rams into a stopped bus at 90 km/h to wreck | 5 (21 a hit) | 19 (13 of 250 a hit) |
  | head-on with a sedan, both at 54 km/h | 27 % of its health | 6 % (the sedan takes 30) |
  | pistol rounds to wreck | 12 | 56 |
  | rear-ending a stopped sedan at 50 km/h, the pair after | 21 km/h | 27 km/h |

- **Fast is the EV flag** (square-root torque, regen, battery-floor grip)
  with `acc` 11: tools/vehicles.mjs's `electric super-pickup` band, 0-100 in
  1.27 s (3.05 s on the spec sheet, before `ARCADE_PUNCH`),
  200 km/h, 100-0 in 17.5 m, 2.55 g -- quicker off the line than
  the performance EV, a 3 t truck that drives like a fast car. The sound is
  `engine: 'evtruck'` in audio.js: the EV motor a quarter lower and no more
  (`audiorender.mjs --only engine-evtruck,engine-ev`: spectral centroid 870 Hz
  against 975, no clipping). **v193: it first went an octave down with rich
  harmonics, a 520 Hz resonance and the saturator driven (702 Hz), and it
  sounded like a gas engine** -- a low buzzy fundamental is what a cylinder
  firing sounds like. A motor of any size is a near-pure tone plus the
  inverter's whine; keep `harm` sparse and `drive` at 1.
- **Rear-wheel steer (v193), like the truck it is after.** `spec.rearSteer`
  (0.175 rad, 10 deg): against the fronts at parking speed, fading out by
  ~45 km/h (yaw = v/L (tan front - tan rear), so the turn tightens: 5.1 m ->
  4.1 m at full lock), and a touch with them from ~65 km/h -- drawn only, as
  the lock already holds the grip limit (90 km/h radius unchanged). Your own
  vehicle only (`detailedWheels`): the AI steers by the plain bicycle model
  inverted (`aiSteer`), which a tighter turn would fight. verify: "the Wedge:
  rear-wheel steer".
- **The bed cover is one matte panel (v193).** It was fifteen slats with a
  1.2 cm dark seam each: far under a pixel from the chase camera, so they
  crawled and shimmered on the move. No sub-pixel stripes on a car body.
- **The light bars light up when you get in.** `spec.lightbar` (each bar's
  height and width) makes `setDetailed(true)` add two unlit boxes over the
  lamp strips, the player's car only (+2 draws, like its articulated
  wheels); `sync` sweeps them out from the centre in 0.4 s at a flash and
  settles to a glow the bloom picks up. `{ color, toneMapped: false }` is the
  police strobes' and the Needle beacon's parameter set: an already-compiled
  program. There is no day/night cycle, so nothing brightens "at night".
- **Where:** parked for good ('apron') on the spawn's kerb, 7.8 m behind or
  ahead of the red sports car -- whichever clears the junction mouths by
  11 m (no map mark or hello since v193: it is right beside you at spawn,
  and the toast read as stray text); $2500 from the pause menu's delivery
  row; and in traffic now and then: a quarter of the EVs drawn for moving
  traffic become Wedges (~1.5 %), by `hash2`, so the spawn stream is
  unchanged. **It is not a `CIVILIAN_TYPES` slot**: that array is hashed for
  kerbside parking, and adding one would move every parked car in the city
  (see "The articulated bus").

## Flying

**The camera jumps were a TUNNEL clamp firing on hillsides.** `updateCamera`'s
bore-ceiling clamp tested "ground over the CAMERA is higher than a bore roof over
the target's deck". For a plane, `groundAt(target, y)` is the terrain under the
plane, so any hillside 17 m behind standing more than 4.8 m higher yanked the
camera down onto the slope, and it sprang back at the damping rate, over every
hill. **The clamp now needs the TARGET in a bore**: on its deck
(`y - deck < 2.5`) with ground over it (`terrain > deck + TUNNEL_H/2`), held for
1 s after the mouth so a boom still inside on the way out stays under the roof.
`tools/camtunnel.mjs` confirms no camera goes through a bore roof (0 of 24
stations, unchanged heights).

Two smaller contributors:

- **Boom pull-in on towers.** `clearCamDist` snapped the boom 17 m -> 1.5 m and
  back as towers went by on a low pass. An airborne plane skips it; a plane on
  the ground taxis like a car and keeps it.
- **Damping a world position is dt-dependent lag.** `damp(camPos, wanted, 9)`
  trails a 116 m/s plane by 12.0 m at a 16 ms frame and 9.7 m at a 60 ms hitch,
  so an uneven phone clock surges the boom. A plane's rig damps the OFFSET and
  follows the plane's translation exactly. Cars keep the old follow: their lag
  is part of how speed feels.

Measured with `tools/flycam.mjs` (Boeing Field take-off, the hills, downtown
below the tower tops, Elliott Bay, climb-out; ~13k airborne frames at fixed
1/60, and `--jitter` for a deterministic hitchy clock):

| | before | now | now, `--jitter` |
|---|---|---|---|
| ceiling-clamped frames | 382 | **0** | 0 |
| worst per-frame camera move relative to the plane | 310 m | **0.18 m** | 0.72 m |
| frames moving > 1 m relative to the plane | 370 | **0** | 0 |
| worst on-screen plane movement per frame | 92 px | **4.8 px** | 13.4 px |
| worst look-direction change per frame | 90.4 deg | **0.68 deg** | |
| boom length range | 14.7-33.9 m | 16.8-18.4 m | |

**`flyLod` keys off altitude over the terrain directly underneath**, which swings
140 -> 40 m crossing Beacon Hill or Queen Anne, so its 100 m up / 60 m down
hysteresis flipped 7 times on the route. While `world.playerFlying` (fed from
main.js) it only drops back below 25 m: one flip, the take-off.

### The hangar: seven fixed-wing types and a helicopter

Trainer, sport single and floatplane (`buildPlane`), and on the aircraft kit
in vehicles.js: the King Air-style `twin`, the Learjet-style `jet`, the
Stearman `biplane` and the Bell 407-style `heli`. `tools/aircraftshots.mjs`
photographs them (stage, apron, close cockpit), flies the helicopter
(`--flight`) and times every fixed-wing type off the runway (`--takeoff`).

| | ground roll | rotates | level, full throttle | full-bank turn |
|---|---|---|---|---|
| plane | 32 m | 102 km/h | 412 km/h | 32 deg/s |
| sportplane | 25 m | 102 | 486 | 32 |
| twin | 37 m | 116 | 447 | 23 |
| jet | 51 m | 157 | ~560 | 28 |
| biplane | 21 m | 76 | 234 | ~45 |

- **Handling is `spec.fly`** (vr, stall, bank, turn, climb, vne); a type
  without it flies as the trainer (`PLANE_FLY`). `vne` is a soft cap: drag
  leaves every airframe ~30 % over its declared top in level flight, and the
  streamer is proven to ~120-150 m/s, not beyond.
- **A taildragger pivots about its main wheels.** `spec.taildragger` is the
  three-point attitude and `zMain`; updatePlane draws the body `yVis` lower
  as the nose comes up, and `place()` parks it on its tailwheel. The builder
  hangs the tailwheel exactly `(zMain - zTail) tan(deg)` above the ground.
- **updatePlane writes `pitch`/`roll` and calls `sync()`.** It used to set the
  tilt group directly, and traffic.js's post-collision `sync()` levelled
  every parked plane again; and the flown plane was drawn `wheelR + 0.25` up,
  so it taxied 55 cm off the tarmac while the parked ones sat on it.
- **Propellers and rotors are spin parts** (`spinPart`): baked still into the
  parked/traffic/far geometry and hung live only by `setDetailed(true)`.
  Parked aircraft are 3 draws; the flown one pays 1 per prop or rotor
  (trainer 4, twin and helicopter 5). The live prop used to exist on every
  plane and spin at idle beside the runway.
- **Windows are cut into the skin** (`hullLoft`'s `pick(i, k)` sends each
  quad to paint, glass or matte), so the heli's bubble and the flight decks
  are really see-through onto a cabin with a pilot. Cabin windows over solid
  skin are backed panes (`skinWindow`). Two traps: a livery band must be
  sampled AT the hull's stations (the skin is straight between them, so a
  band sampled between them cuts the corner and sinks under a convex nose,
  showing as dashes), and anything inside must be sized off `skinX` -- the
  hull narrows fast under the centre line and a fixed-width floor stood out
  of both flanks.
- **Boeing Field's slabs stand 35 cm proud of the graded field.**
  `airportSurface` (landmarks.js, the same `AIRPORT_PAVE` table the landmark
  draws) is installed as `city.slabQuery`, and groundAt takes it as the top
  surface wherever it is higher and in reach -- the ramp rule. It started as an
  aircraft-only query, which left every car and walker on the apron 35 cm
  inside it; one query in groundAt serves them all. Kerbs of the real street
  crossing the apron's west side still win where they are drawn higher. The
  table also fixed the taxiway stubs, which carried an extra quarter turn and
  lay parallel to the runway joining nothing.
- **The apron is not all clear.** A real street with pavements runs through
  its west side (across -260..-230) and a hangar stands at across -215..-185,
  along -50..-10 (the first trainer was parked half inside it). The spots in
  main.js and `AIRPORT_HELIPADS` avoid both.

**The 747-8** (`jumbo`, `buildJumbo`, v143), the largest airliner Boeing has
built, parked on the east taxiway at the north end (along -1240), nose south
toward the runway: 76.3 m, the upper-deck hump 27 m back from the nose, a
windscreen cut into its skin over a flight deck, ~290 cabin windows on two
decks, five doors a side, a house livery (white, pale belly, blue cheatline and
fin), raked swept wings with flap-track canoes, four GEnx nacelles on pylons,
a 19.4 m fin, a nose gear and four four-wheel bogies. `wid` is the fuselage
(street-scale collision); the wings are drawn. It flies the ordinary plane
model with `fly.thrustK` 0.62 so it winds up like a heavy (roll ~410 m,
rotate at 140 kt, ~550 km/h level, 8 deg/s turns). Its climb has its own
`fly.climb` 34 and `climbBase` 7 (v149): the light aircraft's 14 / 4 scale
with speed over the stall, which on a heavy's 58 m/s stall left it climbing
4.6 m/s -- 88 m in the first 20 s; now ~8 m/s, 150 m, and the chase rig scales
with any aircraft over 30 m long (player.js). `seeFar` 7 km.

**Altitude on the HUD** (v149): flying a plane or the helicopter, `#altRow`
under the speed reads the height over sea level (`hud.js`); the balloon's
main readout is already its altitude.

**Parachutes** (`src/parachute.js`, v144). Get out of any aircraft more
than 12 m over the ground -- a plane, the helicopter, the balloon -- and you
jump (player.js `exitVehicle`; it used to set you straight down on the ground
under it). `player.sky` has the frame while you are in the air:

- **Free fall**: gravity against quadratic drag, terminal 55 m/s belly to
  earth; you leave with the aircraft's velocity. The stick tracks you across
  the sky (camera-relative, ~14 m/s). JUMP opens the canopy; it opens itself
  at 60 m over the ground or water.
- **Under canopy**: a nine-cell ram-air wing on its lines (two draws, built
  once), ~10 m/s forward and 5 m/s down; the stick turns it, forward dives,
  back flares. Landing under canopy is harmless; free fall into the ground
  is not. Into the water, a boat puts you on the nearest shore after 1.6 s.
- **The camera** follows a skydiver rigidly, as it does a plane (player.js
  `plane` / `airPlane` include `this.sky`): the on-foot rig damps height at
  4.5, which at 55 m/s trailed the body by 10 m and out of the frame.
- **A jump ends without landing** (`Player.endSky` -> `Skydive.cancel`) when
  you take a vehicle under the canopy or respawn: the canopy, HUD and boom go
  back, no fall damage. Otherwise `sky` outlived `enterVehicle` and kept the
  plane camera and the canopy on a car.

verify's "parachutes" section: terminal speed, the auto-opener, an early
opening flown down, a water landing put ashore -- unhurt each time.

**The fighter** (`fighter`, `buildFighter`, `updateFighter`, v113) is the one
aircraft with a full 3D attitude. The others fly heading + bank + climb rate,
which cannot go over the top; the fighter keeps a quaternion `v.q` and the
stick turns it in the BODY frame (y pitches, 1.9 rad/s; x rolls, 3.5 rad/s,
both fading below the stall), velocity along the nose, thrust (`fly.thrust`
21 m/s^2 -- `acc` stays the arcade figure deriveSpec validates) against drag
and `9.8 * F.y`, so a climb bleeds speed and a dive builds it. Heading, pitch
and roll are read back out in YXZ, the order `sync()` draws, so everything
else sees the usual fields. Touchdown wings-level, nose within ~13 deg and a
sink under 9 m/s is a landing; anything else is a crash. It sits on Boeing
Field's runway at the south threshold facing north (map: red delta).

- **Its camera rides in its frame** (`player.updateCamera`'s first branch,
  `camUp`, honoured by `applyCamera`): every other rig yaws round world up,
  which flips the horizon at the top of a loop. Here the boom hangs behind
  and above along the jet's own axes and the camera's up lerps to the jet's.
- Measured: take-off roll 3.3 s; 780 km/h level; full back stick from 326 m
  at cruise turns 542 deg in 5 s (a loop and a half), 1.7 s inverted, back
  above its entry height; full aileron rolls 398 deg in 2 s.
- **Drive a harness through `traffic.update` too**: it is what shows an apron
  vehicle within range, and a probe stepping only `player.update` rendered
  frames with the jet still hidden from boot.

**The helicopter** (`updateHeli`, `spec.rotor`) is built to fly with one thumb:
UP / DOWN (GAS / BRAKE relabelled; triggers on a pad, Q / Z on a keyboard,
whose W / S are the stick) command a climb rate, and **with neither held it
holds its height**; the stick's y is speed along the nose and, released,
decelerates to a hover over the spot; its x is a pedal turn at the hover that
eases into a banked turn at speed. Translation is a world velocity chasing the
stick's, with separate authority along the nose (7.5 m/s², 1.35x to stop) and
across it (14 m/s²): one cap for both slid a 44 m/s turn 35 m/s sideways. The
attitude is drawn from that acceleration (nose down to speed up, banked into
turns) about `spec.pivotY`, the rotor's centre, not the skids. The rotor spools
for 1.8 s before it will lift; abandoned in the air it settles down. It always
collides with buildings (a hover beside a tower is its normal use; the test
already frees anything over a roof). Its camera is the planes' rigid rig,
closer (12.5 m, lengthening with speed), easing round behind a pedal turn even
at the hover, and it keeps the building pull-in below 25 m/s.

### Far massing: lazy, instanced, masked per chunk

Past the 9x9 mid ring (~1.6 km) only the tall skyline existed, so from a plane
the housing stock assembled a row of chunks at a time. The far layer
(`world.updateFarMass` -> `initFarMass` / `farMassSteps`) builds every building
the skyline skips as massing boxes, one mesh per 4x4-chunk supertile. Each box
carries its building's chunk, and a 9x9 uniform mask collapses boxes whose ring
chunk has been DELIVERED (`lod >= 0`): the layer keeps drawing a chunk until its
real geometry is there, with no hole while it builds and no double drawing
after. Buildings materialising in view on the flight route: 50,497 -> ~3,200,
all during take-off before the layer's gate.

- **Only off the ground.** On above 45 m, off below 25 m but never while
  airborne, fading in through the fog colour over 1.5 s; supertiles past 5 km
  hidden. **At street level `farMass` is undefined and costs 0 bytes**, so
  perfguard's ground views are identical with or without it.
- **Instanced, 17 bytes a box**: one shared unit box; per instance centre and
  base as Int16 dm off the supertile origin, size Uint16 dm, rotation (0.7 deg
  steps) and in-tile chunk index Uint8, tint Uint8 x3. The supertile origin
  comes from `modelMatrix[3].xz`, because a shared material would not re-upload
  a per-mesh uniform.
- **Houses merge per 50 m cell** (50 divides the chunk, so the mask stays
  exact): `style === 'house'` or under 10 m and 400 m², one box per cell in the
  largest footprint's frame, shrunk to the members' total area at their
  area-weighted roof line. 104k boxes for the city, 1.69 MB of buffers if every
  tile is built.
- **The first version built at boot and was too heavy**: 255k boxes as
  8 vertices + 30 indices each, 47.7 MB of buffers and ~95 MB resident because
  three keeps JS copies, paid by every on-foot player. Now the build is 3 ms
  slices on the first climb past 45 m, nearest supertile inside `FAR_R` first,
  and the first fade waits until every tile in range exists.
- **Nothing CPU-side may read the freed arrays.** `onUpload` nulls them; the
  bounding sphere is computed before upload, `count` comes from
  `attribute.count`, and `raycast` is a no-op — CPU rays would hit boxes the GPU
  has collapsed, and "raycast the pixel" is this repo's standard diagnostic.
- **Context loss has nothing to re-upload from**, so `webglcontextlost` calls
  `resetFarMass()` and the lazy builder makes them again. On a phone main.js
  now reloads the page on a lost context (the static city keeps no JS copy
  either; see "Memory").
- Flat shading with no normal attribute (8 shared vertices, 10 triangles a box);
  roof darkening is done in the fragment shader by facing.

Flying cost: +10-20 draws (the visible supertiles) and 0-100k triangles a frame;
some views come out cheaper, because merged cells are fewer boxes than per-house
massing and the layer covers chunks while they build. **Watch flying fps on a
real phone.**

### Far roads: the massing layer's road counterpart

Roads stream with the chunks, so from a plane the grid and the freeways
assembled a chunk at a time at the ring edge while the far massing stood ready
around them: **478 road pop-ins in view (1,367 km of carriageway)** on the
flycam route. The far road layer (`world.updateFarRoads` -> `farRoadSteps` /
`buildFarRoadTile` / `farRoadPieces`) brings it to **34 (48 km)**, all during
the take-off before the gate opens.

- **It rides the massing's gate and mask.** Built when the massing is, on the
  first climb past 45 m, and masked by the massing's 9x9 `farBuilt` array
  through its own `frBuilt` uniform (so a harness can unmask the roads alone).
  A piece is filed under the chunk of its EDGE's midpoint — buildChunkStep's
  ownership rule — so a chunk's real roads replace the far ones on the frame
  they are delivered. **At street level `farRoads` is undefined and costs
  0 bytes.**
- **Instanced, 16 bytes a piece**, in 3.2 km supertiles (`FR_TILE`, 8x8 chunks,
  so the in-tile chunk fits a byte and the layer is a handful of draws). One
  shared unit quad; per instance both ends (x, z Int16 dm off the tile centre,
  y Int16 cm), half-width in dm, class and paint flags, chunk, cross-slope.
  Arrays are freed on upload and `resetFarMass()` resets both layers on context
  loss.
- **Heights follow what is drawn, not the node chord.** A graded road or deck
  uses its solved profile (`e.ph`; decks 3 cm under, graded ground roads plus
  the per-edge bias, `e.pg` as the cross-slope byte); an ungraded deck the chord
  between its nodes + 0.06; a draped street the terrain. **The terrain is a
  triangle mesh**, so along a straight edge its height is piecewise linear with
  breaks where the edge crosses a grid line or a cell diagonal (`tx + tz = 1`,
  the split `sampleHF` knows). Sampling exactly there and simplifying to 0.2 m
  (Douglas-Peucker in along/height) gives the drawn ground in one or two pieces
  an edge; only edges the carve touches (portal cuts, underpass dips) add a
  10 m lattice. A draped street's cross-slope comes from the ground at both
  kerbs, or its uphill edge buries.
- **Depth bias along the view ray.** A ribbon on terrain 2-6 km out is inside
  the depth buffer's resolution (~0.5 m at 2 km, ~4 m at 6 km with a 0.5 m near
  plane). The vertex shader pulls `mvPosition` toward the camera by
  `0.6 + d² · 3e-7` m plus 0.25 m per class rank: invisible on screen, and a
  freeway wins over the street it crosses.
- **Detail by distance is a prefix.** Each tile's instances are sorted freeway/
  ramp, arterial, street, residential, and the tile's nearest distance sets
  `instanceCount`. The shader narrows each class to nothing over the last 600 m
  before its limit (`FR_FAR`):

  | class | drawn to |
  |---|---|
  | residential | 3.5 km |
  | street | 4.3 km |
  | arterial | 5.6 km |
  | freeway / ramp | `FAR_R`, capped at the haze |

  **Residential must stay full width past ~2.8 km**, the ring's farthest corner,
  or a chunk arriving at the ring edge brings streets the layer was not drawing.
- **Capped at the haze**: `frCap = min(FAR_R, 1.98 / fog.density)`, where
  FogExp2 reaches 98 %. The first fade waits until every tile inside the cap is
  built; tiles further out keep building behind the fog.
- **Colour is the real road's**: `mats.road`'s asphalt maps and settings (uv in
  metres), its wear profile and the 0.92 freeway tint. Paint is in the fragment
  shader: white edge lines at `hw - min(0.7, hw * 0.06)`, and a yellow centre
  dash (3 m on, 6 m off) at a third of its coverage on two-way roads,
  coverage-filtered by `fwidth` so sub-pixel paint averages to its true tone
  instead of flickering. No paint within one half-width of an edge's end, which
  leaves the junction bare as `meshRoadMarks` does.

Cost: 165k pieces and **2.64 MB of GPU buffers** once every tile in reach is
built (the city's roads are ~5,000 km, two-thirds residential). About
0.5-0.75 s of JS, sliced at 2.5 ms a frame (1.5 ms under the low budget); step
peak ~2-4 ms idle. GC'd heap in flight is unchanged (389.6 vs 388.5 MB), because
the JS copies are gone. Flying: +6-9 draws and +35-70k triangles at the flycam
shot frames, mostly collapsed instances inside the ring.

### flycam: road pop-ins, `i5high`, and why it "hung"

`tools/flycam.mjs` counts ROAD pop-ins as well as buildings: a chunk gaining
geometry in view, less what `world.farRoadsCover(ch, camX, camZ)` says the far
layer was already drawing there, in metres by class (`roadPopEvents`,
`roadPopKm`). An `i5high` shot moves the plane to 450 m over I-5 at z = -9000,
nose south; those frames are left out of every statistic. It also records GC'd
heap at boot and after the flight.

**The reported hang was the harness, twice.** It did not reproduce (4 full runs,
120-270 s, no 300-frame batch over ~5 s), but two ways to wait forever did
exist and both are closed:

- `Runtime.evaluate` had no timeout. Each evaluation now has a wall-clock
  limit (`FLYCAM_EVAL_S`, default 240 s) and reports the frame it reached.
- **A borrowed CDP port drives someone else's browser.** With the default 9341
  already held by another agent's Chrome, ours could not bind it and the
  harness drove the OTHER page; when that browser died, the pending evaluate
  never answered. flycam now refuses a port whose page is not its own
  `about:blank` and exits when the socket closes.

## The seaplane dock, the boat and the quad

**The dock is at Lake Union's real south-west corner** (Kenmore Air's terminal,
47.6290 N 122.3393 W, world ~(-128, -1960)), built by `seaplaneDock()` in
landmarks.js in WORLD axes: a landing running into the bank below the
Westlake car park, a railed pier x -146..-114 on z -1960, a gangway down to a
curbed float x -102.5..-99.5, z -1986..-1934. It used to be a pier 900 m up
the wrong shore with the floatplane parked alone at the real site, which is
why nobody ever found either. `SEAPLANE_DOCK.moorings` is the list main.js
spawns ('apron': two floatplanes, two runabouts); the map marks it (hud
`places`, an anchor icon) and it says hello within 55 m.

- **Its decks are city platforms** (`city.setPlatforms` / `platformAt`):
  oriented rectangles whose top runs linearly along their length, answered by
  `groundAt` under the same nearest-surface rule as a lid. The builder
  registers exactly the top it draws. Measured walking lot -> landing -> pier
  -> gangway -> float against a ray down at the drawn boards: 0-3 cm (the
  0.2 m readings are the ray falling through a board gap onto the pontoon).
- **Rails and curbs are solids for walkers and fenders for boats**: a
  solid's band reaches 2.5 m under its y0, so the float's curb stops a hull at
  the surface too. Moorings sit their collision circle (0.7 x radius) clear of
  the curbs and guide piles, or `updateBoat`'s first frame shunts them.
- **A boat (or a floatplane on water) only lets you out onto land or a
  deck** (`exitVehicle` searches both beams, bow and stern); otherwise it
  toasts and stays. `exitVehicle(true)` (a wreck) always gets you out.

**The boat** (`boat` in TYPES, `buildBoat`) has its y = 0 at the WATERLINE and
`updateBoat` instead of the ground solve: it floats on `waterQuery` (the local
surface), water is where the bed is >= 0.45 m under that surface and
anything shallower refuses the move like a kerb (tried per axis so it slides
along a bank; `shoreHit` feeds the player's crash handling), the last metre
of depth drags, and drag is sized so thrust balances it exactly at the
declared top speed (70 km/h). It turns by thrust (almost nothing at rest
without throttle), slides, bobs, climbs onto the plane through a hump near a
third of top speed, and banks in. Its wake is one ribbon mesh in effects.js
(`fx.wake`), fed only while you drive one. Traffic never spawns one: it is
not in `CIVILIAN_TYPES`. 1.8k triangles, 3 draws.

**The lake must not draw in the cockpit.** The floor (`spec.cockpit`, which
`buildBoat` also draws from) is only 12 cm over the waterline and the water is
one flat plane. Through the hump the bow rises ~0.10 rad and the floor went
12 cm under, so the lake showed between the seats. `updateBoat` lifts the hull
just enough to keep the floor's lowest corner, pitched and rolled, 4 cm over
the surface: a planing hull rides up anyway, and at rest the bob never reaches
it. verify drives one through the hump and both turns and asserts this.

**The quad** (`atv`, `buildAtv`) is a four-wheeled car to the ground solve
with a posed rider (`RIDERS.atv`, visible only while ridden), knobbly tyres
(`addWheel(..., knobby)`: knob tops at the rolling radius, the carcass 10 %
under), `minTurnR` 3 m and `offroad`: half the grade term and none of the
new grass drag. **Road cars now bog down on grass**: a vehicle nobody's AI
drives, off pavement (no lift, not a deck, not a lot), pays extra rolling
resistance (a sedan manages ~110 km/h on a lawn); traffic never leaves the
road so pays nothing. Parked in three places (`ATV_SPOTS`: Kite Hill, the
dock's car park, Seattle Center), each named "Quad bike" on the full map
(an unlabelled orange dot was a quad nobody found), and $700 from the
delivery menu; parked ones freeze once settled. 6.9k triangles + the rider, like the bikes.
Bench band in tools/vehicles.mjs (0-100 2.7 s arcade, 125 km/h since v123).

### Kayaks on Lake Union (v130)

**Four rental kayaks are moored at the seaplane dock's float** (Moss Bay's
rentals are at this end of the lake in life), with a rack of boats, paddles
and a KAYAKS board on the landing (main.js `kayakRack`), marked on the map.
`kayak` in TYPES is `boat: true` -- the float, shore and exit rules -- with
`noEngine` (audio.js skips the engine as it does for the balloon) and its own
`updateKayak`, dispatched before the boat's.

- **Everything is strokes** (`KAYAK` in vehicles.js). PADDLE (gas) paddles,
  BACK (brake) back-paddles, the stick steers; strokes alternate sides every
  0.64 s, each blade in the water for the first 55 %. The shared push yaws the
  bow away from its own side a little (the wiggle a real kayak has); the turn
  makes the outside strokes wide sweeps and the inside ones reverse sweeps,
  which yaw the same way from either side and net no thrust, so at a
  standstill it pivots. Yaw is damped harder with speed (the hull tracks),
  sideslip dies fast. Measured: cruise 2.4 m/s, a paddled turn 34 deg/s, a
  pivot at rest 42 deg/s, back-paddling 2 m/s. It runs in 22 cm of water.
- **The boat's water movement is shared**: `Vehicle._waterMove(dt,
  minDepth)` (the depth probe leading the hull, the lock-level wall, sliding
  along a bank) is what `updateBoat` and `updateKayak` both call. The boat's
  cockpit check reads 4.0 cm either side of the change.
- **The paddler holds the paddle.** A shared figure in a yellow life vest (the
  hi-vis loft), seated with legs forward (`RIDERS.kayak`). Each frame
  `_paddleStroke` poses the paddle -- the stroke blade from the feet to the
  hip, 86 cm out and under the surface; through the recovery it rolls over to
  the other side; at rest it lies across the cockpit -- then solves both arms
  onto its grips with a two-bone IK (`solveArm`: the elbow in the plane of a
  pole out, down and back; each bone aimed from its child's bind offset, so it
  fits any humanoid) and twists the torso toward the catch. The paddle is one
  extra draw, made in `setDetailed(true)`.
- Each catch splashes: water off the blade (`fx.droplets`) and a small
  positional `splash`.

verify's "kayaks" section paddles one at fixed dt and checks the cruise, the
blade under the surface mid-stroke, both kinds of turn and back-paddling.
`docs/kayak/` has shots.

### Marinas, seaplane bases and the jet ski

**Ten docks round the region** (`landmarks.js` `MARINAS`, v112): Renton's
seaplane base on Lake Washington's south shore and Seattle Seaplanes on Lake
Union's east shore (floatplanes), and boats and jet skis at Shilshole,
Elliott Bay, Bell Harbor, Leschi, Carillon Point, Kirkland, Meydenbauer Bay
and Luther Burbank. Each is laid out from its real site by `marinaDock()`:
a pier off the bank, a gangway, a floating walkway (a T-head only at the
seaplane bases), piles, curbs as solids, and every top a platform. Its
moorings spawn in main.js as 'apron' (skipped past 300 m), and each is a map
place that says hello (its own `hello`, if the spec gives one). The islands'
four and the small lakes' five (below) came later.

- **Site from the DRAWN shore, not the water mask.** The mask's edge and the
  terrain's crossing of the water level disagree by tens of metres on a 40 m
  DEM: sited on the mask, docks stood out in the water with their piers
  reaching nothing. Land nearest the site (ground over the local surface,
  dry 25 m out in most directions, or a breakwater or a DEM pixel counts),
  the water 2 m deep nearest that, and the crossing between them.
- **Overlap neighbouring platforms.** Meeting exactly, the joint between
  pier and gangway belonged to neither, and a walker fell through it to the
  bed. Each piece is 6 cm longer at both ends.
- **No T-head across moored bows**: craft lie bow-out along the walkway, and
  a head's fender pinned every one of them to the float.
- **Nothing solid in the path of a craft driven off bow-out.** A mooring sits
  its collision circle (0.7 x radius: 1.67 m a runabout, 0.94 m a jet ski)
  clear of the float's curb (1.3 + 0.15 out), the walkway's two guide piles
  stand at its inner end, behind every mooring, and a plain head's two go
  through its deck. Touching the curb, every craft scraped it all the way
  off; midway along the walk, a pile stood in front of the craft behind it;
  just off the head's corners, two more in front of every craft. "Without a
  shore contact" had been measured, crashes had not: jet skis made 18 m in
  3 s at full throttle, with a crash, at every Lake Washington and Elliott
  Bay marina. Now 54 m (boats 25), nothing touched. At the seaplane bases a
  jet ski moored along the walk still meets the 30 m T-head if driven
  straight off: steer.

Walked from 12 m inland out onto every float (groundAt from the ground):
worst step 0.53 m, the kerb up onto the pier. Every moored boat and jet ski
drives off at full throttle without a shore contact.

### Docks on the small lakes

**Every lake with its own water plane has a dock** besides Lake Washington
and Lake Union (`MARINAS`, `lake: true`), each off a park on its real
shore: Green Lake Boat Rentals by the boathouse (east shore; 2 boats, 2 jet
skis), Bitter Lake Playfield (south end), Haller Lake's N 125th St street
end (west shore), Lake Boren Park (Newcastle, south-west shore) and Big
Finn Hill Park's beaver pond (Kirkland; unnamed in OSM -- a wetland pond,
`natural=wetland` + `water=pond`, 47.722 N 122.232 W -- west shore), a boat
and a jet ski each. They are 50-133 m up, so everything about them is the
LOCAL water level: `waterQuery` already is.

- **`lake` docks measure depth against the lake as DRAWN** (the lake's own
  mask, `waterLevelAt`), the hulls' rule. The water mask stops short of a
  shelving bed the 40 m dig left drawn under the lake: sited on the mask,
  Green Lake's float stood 36 m out past drawn water already 1.4 m deep, and
  its walkway ended short of the last mooring.
- **Sized to the lake**: `float` caps the walkway (12 m; Green Lake 20), and
  the pier stands 0.9 m over the water, not 1.3: there is no tide, and at
  1.3 the landing was a 0.77 m step up off a low bank.
- **Mind what the drawn lake already holds.** The first Green Lake site put
  the boats alongside the Greenlake Boathouse, which stands in the drawn
  lake (below), and its footprint stopped a runabout 5 m off its mooring;
  the first Bitter Lake site's pier began against a building's corner. Both
  were moved along the shore (check `world.inBuilding` along a candidate
  shore before choosing).
- **No prop in the drawn lake** (`world.inDrawnLake`): park trees, benches,
  tables and street furniture used to test the water mask only, so 173 park
  trees in one session's chunks (and Haller Lake's street-end park's tables)
  stood in drawn water, solid to a boat. `waterLevelAt` is the lake's own
  mask now, not its box, so the old warning against it (it deleted 105 of
  Green Lake's park trees when it answered over the box) no longer applies.

verify's "the small lakes' docks", per dock: the landing dry; each craft
over >= 1 m of water at the lake's level; each driven off at full throttle
3 s (54 m a jet ski, 25 m a runabout, no shore contact, no crash); stepping
off onto the float; the walk from 12 m inland onto it (worst step 0.37 m);
over the side mid-lake into a swim; **a runabout lap of the lake** at fixed
dt, the heading written each frame along a distance field 12 m (Green Lake
25 m) off everything it cannot float in or must steer round (depth under
its 0.3 m, docks and rafts, buildings standing in the lake, the box edge),
so a shore contact there is an invisible wall: 0 on all five (Green Lake
4.6 km, the others 1.1-1.4 km); and no prop in the drawn lake. Exploring
before that: 16 spokes per craft from each lake's middle to the shore at
full throttle stopped at most 5.5 m (runabout) / 2.5 m (jet ski) short of
the drawn shoreline, never with deep water behind; the lake reachable from
each dock is 100 % of the water deep enough for the hull. Cost: a dock is
2 draws and 0.6-1k triangles, each moored craft 3 draws (apron craft are
skipped past 300 m). As the phone (AUTO_PHONE GPU harness, from the bank
behind each dock, median of 60 frames, master -> this): Green Lake 107 ->
125 draws (four craft), Bitter 90 -> 99, Haller 96 -> 105, Boren 94 -> 97,
the Finn Hill pond 74 -> 81; triangles within noise; GPU ledger +2-4 MB.
`docs/lakes/dock-*.jpg`.

Known, left as imported: the small lakes are drawn ~2.5x their real area
(Bitter Lake 37,300 m2 in `water.json`, ~96,000 m2 deep enough to float a
jet ski), so OSM buildings on the real shore stand in the drawn water --
the Greenlake Boathouse, five round Bitter Lake, one at Lake Boren -- and a
craft stops against them; and where the dug bed runs past a lake's box its
plane stops at the box, a straight edge over a 1-2 m step (78 m of Green
Lake's east edge by the boathouse, 100 m of the Finn Hill pond's).

**The jet ski** (`jetski` in TYPES, `buildJetski`) is `boat: true` -- the
boat's float, shore and lock rules, wake and exit -- on a 3.2 m hull with the
quad's posed rider (`RIDERS.jetski`, shown only when ridden), 105 km/h, and
in `updateBoat` 1.75x the yaw and three times the lean: 61 deg/s through a
full-lock turn at speed, leaning 19 deg. Not in traffic. **Re-shoot vehicle
geometry with a bumped build** or cleared `/tmp/auto-*` profiles: the boot
cache keeps vehicle geometry per build, and a harness profile that survived
showed the old hull.

### Hulls go where the water is drawn (v145)

**The water mask is not where the water is drawn.** The sea is one plane at
0 m, so any ground under it is drawn as sea -- but the 10 m mask and the 40 m
DEM disagree along the shore, and `world.waterLevelAt` (null off the mask)
made every such cell a wall: a jet ski running north along the waterfront
from downtown stopped dead in open water off Pier 66 / Myrtle Edwards. The
hulls' query (main.js `setWaterQuery`) now counts ground more than 15 cm
under the sea's surface as sea too. And a small craft runs in shallow water:
`spec.minDepth` is 0.12 m for the jet ski and 0.3 m for the runabout (the
boats' 0.45 m had shallow shelves under drawn water acting as walls too).
verify's "elliott bay" drives a jet ski through two of the old walls.
Known: Smith Cove's two long piers (90 and 91) are not drawn; their sheds
stand in the water.

### The ship canal is at lake level

**Only the lakes are labelled**, each by its bounding box in `water.json`, so
every canal cell used to answer the sea's 0: Salmon Bay, the Fremont Cut and
the Montlake Cut were trenches of sea-level water, with a 5.3 m water cliff
at each edge of Lake Union's box, and a boat could not leave the lake. In
life the Ballard Locks hold the whole canal at lake level.

- **`G.shipCanal(lakes)` (geo.js) finds the canal**, memoised: a flood fill
  over the water mask from Lake Union's wet cells, through wet cells outside
  the lake boxes, stopped at the `locks` landmark's centre gate. It is
  windowed and capped at 40k cells; if it runs away it logs and returns null,
  and the canal stays at sea level rather than Puget Sound rising 5 m.
  11,745 cells today.
- **It reaches one cell INTO each lake box.** A point just outside a box
  rounds to a mask cell whose centre is inside it; a canal that stopped at
  the box's own cells left a 5 m seam at sea level on every box edge, and a
  boat jammed on it. The box answers first inside, so nothing inside changes.
- **`world.waterLevelAt` asks it** after the boxes, and citygen's `standY`
  too: Salmon Bay's boathouses stood up to their roofs once the water rose.
- **It is drawn by one masked plane** (`world.canalMesh`): a lake-style
  bounding-box plane would flood every low bank from the Locks to Montlake.
  The mask is the canal dilated one cell, bilinearly sampled and discarded
  under 0.5, so the edge is a smooth contour into the bank. Its UVs continue
  Lake Union's, so the swell crosses the box edge unbroken. +1 draw where the
  canal is in view.
- **A boat treats a jump in water LEVEL as a wall** (`updateBoat`, 0.5 m),
  which is what stops it at the Locks rather than dropping 5 m into the
  Sound. Lake Washington sits 22 cm below the canal and passes.

Driven with a fixed-dt boat over a BFS path (heading written each frame, as
tunneldrive does -- a steering autopilot measured itself, not the water):
dock to the Locks 8.3 km in 412 s, 0 shore contacts, held at the lock chamber
at full throttle; dock to Lake Washington through the Montlake Cut, settling
5.31 -> 5.09 m. Worst vertical move per frame 3.7 cm, the swell's bob.

## Bicycles and the bike paths (v147)

**Seattle's bike paths are drawn and ridden** (`src/bikes.js`).
`tools/build_bikepaths.py` (~15 s) keeps every highway=cycleway and every
path/footway/track signed bicycle=designated: ~260 km, the Burke-Gilman
(22.5 km in the box), the I-90, Alki, SR 520, Elliott Bay and Duwamish
trails, Green Lake's loop. Each way keeps its end node ids so the ways join
into a network.

- **Drawn** as 3 m ribbons (2.2 m gravel where unpaved) with a dashed yellow
  centre line and white edges, every vertex on `terrainHeight` + 5 cm with a
  polygon offset, cut to ~4 m. Not drawn: bridges and tunnels (the road
  import already draws what they cross), pieces on a carriageway (a sidepath
  mapped along a road), over water or in a building -- ~190 km drawn. 1 km
  chunks shown within 1 km (600 m on a phone): +2-6 draws.
- **Trees, furniture and parked cars keep off them**: `city.extraClear`
  asks `bikeNet.keepClear` (a 40 m segment grid) with Link's.
- **Cyclists** are `bicycle` Vehicles in traffic's list in mode `path`,
  which traffic neither drives nor despawns: `Cyclists` keeps 8 (4 on a
  phone) within ~480 m, spawned 150-450 m out, riding 4-6.5 m/s on the right,
  turning onto another way at each node and round at a dead end, leaning
  into turns, slowing and ringing the bell (`bike_bell`) for someone on
  foot in the way. Take one like any vehicle.
- **Bike-share docks** at trailheads (`DOCK_SITES`, snapped to open, dry,
  level ground beside the nearest drawn path; 9 of 11 find one): racks, a
  kiosk, five green bikes ('apron'), refilled while you are 260 m+ away. On
  the maps as "Bikes · <place>".
- **The bicycle** (`bicycle` in TYPES, `buildBicycle`): a city bike -- a
  diamond frame in the livery, steel fork, flat bar, levers and bell, sprung
  saddle, full fenders, a rear rack and lamp, a front basket, chain,
  cassette, derailleur, kickstand -- on 700c wheels with 32 laced spokes
  (`bikeWheel`, wheel kind 'bike'). `moto` gives it the two-patch ground
  solve and the lean; `noEngine`, no engine. ~27 km/h flat out, 20 km/h in
  3 s (arcade). The horn is the bell.
- **Pedalling** (`Vehicle._pedal`, from `sync`): the crank is a spin part at
  the bottom bracket, turned with the rear wheel at 2.4:1 while pedalling
  and freewheeling otherwise; the rider's ankles are solved onto the pedals
  and his hands onto the grips every frame (`solveArm`, which now takes a
  pole, forward for a knee). Its chase camera is close (4.4 m).

verify's "bicycles" section: the paths drawn, the docks stocked, a dock
bike ridden (top speed, time to 20 km/h, the cranks turning), a minute of
cyclists at Green Lake all on the paths, no trunk on a path round Gas
Works. `docs/bikes/` has shots.

## The jet ski and the runabout, rebuilt (v147)

- **The jet ski** (`buildJetski`) is a modern three-seat PWC: a deep-V hull
  with two strakes and a chine flat, sponsons aft, topsides in the livery
  with a dark sweep and pinstripe, a rub rail; footwells with a raised lip,
  a stepped two-tone saddle with livery piping and a grab handle; a long
  hood with the storage lid's shut line and vents rising into a steering
  pod (visor, display, bars, grips, levers, mirrors); a swim platform with a
  reboarding step, and the jet's nozzle, reverse bucket, ride plate and
  intake. The rider's hands and seat are where they were.
- **The runabout's outboard** is a 150 hp four-stroke: clamp bracket and
  trim ram, black lower cowl, a sculpted white top cowl with a livery band
  and vents, a foil-section leg, anti-ventilation plate, torpedo gearcase and
  skeg, a three-bladed prop. Also teak swim platforms with a ladder, running
  strakes, cleats, and the bimini stowed in its boot. `docs/boats/`.

## The hot air balloon

**A balloon stands inflated on the lawn over Jefferson Park's reservoir lid**
(Beacon Hill; `BALLOON_SITE` in main.js, v125): dead flat at 98.7 m, open for
80 m every way, kept clear of the park's trees (`city.clearCircles`), marked
on the map, with a quad parked beside it. It is a `Vehicle` (`balloon` in
TYPES, `buildBalloon`, `updateBalloon`), flagged `plane` so it gets the
aircraft paths (the far massing while airborne, no horn) and dispatched
before them.

- **Built to a 77,000 cu ft sport balloon** (`BAL`): an envelope 18 m from
  mouth to crown, 16.5 m across, 24 gores lofted one by one so each bulges
  between its load tapes (the tapes are the creases where two gores' normals
  meet), in colour bands -- a rainbow with a navy-and-white chevron belt and a
  navy crown; a dark lining up the throat and a Nomex skirt; sixteen flying
  wires; a stainless double burner on four padded uprights; a wicker basket
  with a suede rim, skids, handles and four propane cylinders; a pilot whose
  right hand goes up to the blast valve when you burn, and a flame.
- **The envelope is in the MATTE draw**: the paint material takes one tint per
  car and drops vertex colour, which left the rainbow plain silver.
- **Flying it is flying a balloon.** BURN (gas) heats the envelope, VENT
  (brake) dumps heat, and it always cools on its own: a 1 s burn about every
  10 s holds a height, with the lag a real one has. Buoyancy is the heat over a
  neutral 62 deg against quadratic drag, 4-5 m/s up or down flat out. It goes
  where the WIND takes it, and the wind turns and builds with height (calm on
  the ground, ~8 m/s at 500 m, blowing toward downtown up high), so you steer
  by choosing a height. The stick adds a gentle 5.5 m/s push along the basket
  and turns it (rotation vents). The HUD reads altitude, not speed.
- **It lands on whatever the basket meets** (`_balloonFloor`: ground, decks,
  roofs, water); over 5.5 m/s it hurts. **The envelope stays out of towers**
  (`_balloonEnvelopeHit`: any footprint within 7.6 m whose roof is above the
  mouth pushes it out); the basket collides like the helicopter's airframe.
- **`seeFar`**: apron vehicles vanish at 80 lengths, which for a 1.6 m
  basket would be 128 m; a balloon shows to 4 km. Lost (despawned, wrecked),
  a new one appears at the park when you are 400 m+ away.
- No engine: `audio.enterVehicle` returns early for it, and the burner is a
  looped bank sound (`burner`) played while it is lit.

verify's "hot air balloon" section flies it at fixed dt: climbs on the burner,
holds within metres on short burns, drifts on the wind, lands softly on the
vent, and keeps its envelope off the tallest downtown tower when shoved into
it. `docs/balloon/` has shots.
