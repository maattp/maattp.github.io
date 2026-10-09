# Auto: On foot

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Swimming (v154)

**Deep water is swimming, not death** (player.js `updateSwim`). On foot,
water more than `SWIM_DEPTH` 1.3 m deep (surface to the ground under you,
against `waterAt` -- the drawn surface, the boats' rule) takes you off your
feet: you lie along the surface at a front crawl, 1.8 m/s (2.8 sprinting),
steered like walking, the arms windmilling and the legs kicking, a splash at
each hand's entry. Stopped, you tread water upright, head and shoulders out.
The camera follows the surface, not your feet.

- **Out**: onto anything within 1.3 m of the surface -- a shelving shore
  (where it is shallow enough you stand), a dock's float, over its curb (a
  solid, so the swimmer hauls over it onto the deck behind); a sea wall or a
  pier deck higher than that stops you. ENTER beside a boat climbs in.
- **In**: walk in, fall in (a splash), step off a boat away from the shore
  (it used to refuse: now you go over the side), or drive a car into deep
  water -- it sinks and you get out and swim (`onCarSank`; it used to kill
  you).
- The parachute's water landing still has a boat fish you out.

verify's "swimming": a fall into Lake Union swum to the seaplane float and
out onto it, unhurt; off a boat in open water; a car into deep water; and
the stroke itself at three headings (below). `docs/swim/` is v154,
`docs/swim2/` the stroke's rebuild, before | after.

### The stroke is driven by the hand (swim.js)

**The v154 crawl was wrong twice over, and neither showed in its one
screenshot** (taken heading north, the one direction where the first bug
vanishes):

- **The pitch was about world x.** The group's Euler order was three's
  default XYZ, so `rotation.x` turned the body about the WORLD x axis after
  the yaw, not about its own left-right axis. Heading north (+z) it lay prone;
  heading west it lay ON ITS SIDE across its own path, heading south on its
  back, feet first. The player's group is now `rotation.order = 'YXZ'` (yaw
  outermost); with x and z at 0 the two orders are the same matrix, so walking
  is untouched. The skydive's free fall (parachute.js, the same `rotation.x`
  on the same group) had the same bug and is fixed by the same line.
- **The arm ran the circle backwards.** `shoulder.rotation.x = -phase` swings
  the arm forward through the front of the body -- prone, that is DOWN -- so
  the hand pulled FORWARD under the water and recovered BACKWARD over it:
  `tools/swimcam.mjs` measured, heading north, 35-44 frames in 90 of the hand
  moving forward relative to the body under water and none moving back, and
  41-50 frames moving back over it. That is "he moves his arm in the opposite
  direction". The abduction sign was mirrored too (`s * ...` with s = +1 on
  the L bone adducts it, toward the midline), the head was craned 57 deg up as in breaststroke, the pose
  switched from treading to crawling in one frame at 0.35 m/s, and the splash
  fired at the body's centre.

The laws now:

- **A hand path, not a spinning shoulder.** Each wrist follows `CRAWL`, a
  closed path in the WATER's frame (forward of the shoulders, height over the
  surface, out from the midline): entry in front of the head at the surface,
  reach, catch under a high elbow, pull under the chest toward the midline,
  push to the thigh, exit, and a recovery low over the water. It is a C1
  Hermite through timed keys. Under water 0-0.67 of the cycle, backward past
  the body through the whole pull (0.93 m); the arms half a cycle apart.
  `armIK` puts the arm on it.
- **The IK sets the whole upper arm, twist included**: its hinge (local x) is
  the normal of the shoulder-elbow-wrist plane, so the elbow is a pure hinge
  and the palm faces back through the pull. solveArm's `setFromUnitVectors`
  leaves twist to chance and is degenerate with the arm straight overhead,
  which the crawl is twice a cycle. Allocation-free.
- **The pole must never point near the wrist.** The arm's plane is pole x
  (shoulder -> wrist); as they align it spins, and the palm flipped 79 deg in
  one frame at mid-recovery with a pole straight up and out. The pole is up
  and out through the pull, forward as the hand leaves the water (the elbow
  leads it), then up; the recovery path stays 0.4-0.5 m out from the midline
  so the wrist is never folded onto the shoulder. swimcam's probe prints the
  palm's largest turn in a frame (now ~20 deg at the stroke's quickest point;
  watch it after any change to `CRAWL` or the pole).
- **Roll and breath**: the shoulders roll 34 deg toward the recovering arm
  (spine and chest), the hips a little over half that (hips bone). The face
  is DOWN in the prone body's neutral -- prone, +z is down -- looking a little
  ahead; it turns to breathe toward the R arm's side as that arm recovers,
  the same side the roll lifts (sign checked by the face normal in the probe).
- **Flutter kick**: six beats a cycle from the hips (0.13 rad), the knee
  bending on the up-beat, toes pointed; hip-flexed a little so the feet stay
  under. Kicking from 0 the soles broke the surface behind the body and read
  as detached shoes.
- **Height**: feet 0.18 m down (`SWIM_FEET`) at pitch 1.47 puts the back and
  the back of the head at the surface. At 0.3 / 1.45 the water (opaque) hid
  everything but an arm. Treading: feet 1.30 m down (`SWIM_TREAD`), the
  surface across the upper chest, the hands sculling just under it -- deeper,
  a treading swimmer was a man standing still.
- **Crawl and tread blend** on `swimSt.w` (speed 0.2-0.7 m/s, damped): the
  pitch, the depth, the hand targets and poles, the legs (eggbeater when
  treading) all interpolate. A fall carries you under (`plunge`, the fall
  speed decaying) instead of starting at swimming depth.
- **Into and out of the water cross-fade** (`PoseBlend`, 0.3 s): the bones
  slerp from a snapshot. The walk reads some of its last pose back (`mix`),
  so its unblended pose is kept aside and restored before it runs, and the
  group's pitch is 0 while it runs (its locks read the group matrix). **The
  walk writes only some axes of some bones** (an elbow's x only, a thigh's x
  and z), so leaving the water zeroes every bone (`clearSwim`) or the last
  stroke's twist stays in the walk.
- The splash is at the entering hand, 12 cm ahead of the wrist, when its
  phase crosses 0.
- The chase rig is closer and lower while swimming (4.0 m, look 0.9 m over the
  feet): the walker's looked 1.3 m over the surface and left a smudge at the
  bottom of the frame.

**Verify**: verify's swimming section swims 100 frames at headings 0, -pi/2
and 2.5 and requires the body (hips -> head) along the heading (dot > 0.9;
0.987) and the R hand, against the shoulders, moving back under the water
(39 frames) and never back over it. `tools/swimcam.mjs <dir> swim|sprint|
tread|in|out [chase,side,above,front]` shoots it (AUTO_GPU=1);
`SWIM_PROBE=1` prints the per-frame hand table, the tally, the palm turn and
where each splash fired. gait.mjs is byte-identical.

## Fighting on foot

**ATTACK on foot used to do its damage with the body standing still**: a
`peds.hitAt` 1.2 m along the current heading on the press, a sound, and no
pose at all ("it does something, but I don't see a punch"). Armed, the shot
snapped the heading to the camera with the arms still swinging at the sides
and no gun anywhere. `melee.js` (`Fighter`, one per player) is the fix.

- **An overlay on the walk, not a replacement for it.** `animateWalk` poses
  the whole body; `Fighter.apply` then turns the trunk (hips -- only standing,
  their yaw would swing the planted feet -- spine, chest; the head counters it
  to stay on the target) and puts each wrist on a hand path with swim.js's
  `armIK` (exported for it), slerped over the walk's arm by a weight that
  rises in 0.06 s and falls in 0.22. The legs keep walking underneath.
  **The walk's own pose is saved before the overlay and put back before the
  next walk** (`restore`, like PoseBlend's), so the walk never reads it; with
  nothing to show `apply` returns before touching a bone, and `gait.mjs` is
  byte-identical. Note `q.slerpQuaternions(a, q, k)` copies `a` over `q`
  first -- the blend-in was a no-op until the IK result was slerped from a copy.
- **The combo**: jab (lead hand, the R bone -- the L bones are the character's
  RIGHT), cross (rear hand, 0.58 rad of trunk in it, the lean), and a lead
  hook (elbow out and up, 0.52 rad) on a third press inside 0.3 s of the last
  punch ending. 0.28 / 0.32 / 0.38 s, each a chamber, a strike segment eased
  `smooth(t^1.6)` (it peaks late and still arrives at rest -- the snap), a
  hold and a recovery to the guard (fists at the chin, held 0.35 s after the
  last punch). Keys are `PUNCHES[].path` `[u, out, up, fwd, pron, pole]` in
  the body's frame; the third key IS the hit frame (set from `hit / dur`).
  Hand path, `meleecam.mjs` probe, standing: the jab's wrist goes 0.22 ->
  0.61 m ahead of the shoulders in 4 frames at 1.48 m (shoulders 1.43) and
  comes back to 0.22; the cross 0.15 -> 0.62 at 1.46; the hook arrives 0.37
  ahead and 0.08 PAST the midline at 1.49 -- round, not straight.
- **Damage on the hit frame, not the press** (`hitDue` -> `player.landPunch`):
  14 / 18 / 26. A civilian (30) survives the jab and goes down to the cross;
  the probe's 40-hp sparring partner takes all three.
- **Soft lock**: on the press, the nearest pedestrian or cop within 2.2 m
  inside 60 deg either side of the CAMERA's line (`meleeTarget`). Until the
  hit frame the body turns to them at 20 rad/s (the stick still moves you but
  does not steer) and steps in to 1.05 m -- a pedestrian knocked back by the
  last punch is otherwise out of reach of the next (the hook missed in the
  first probe). At the hit frame the locked target is hit if in front and
  within 1.9 m, else whoever is 0.95 m in front of you.
- **The victim**: `peds.strike` (hitAt goes through it). Given the
  attacker's position a survivor STAGGERS (0.55 s: driven back ~0.4 m,
  turned to face you, head snapped back, trunk rocked, arms out -- forward
  they reached like a sleepwalker's) before fleeing; one it floors goes over
  BACKWARDS away from you (`fallBack`: the group's order becomes YXZ so the
  pitch is about the body's own axis, lifted by the back's depth as it goes
  over, carried ~0.4 m over the fall instead of moved in one frame, knees
  giving and arms flung up -- straight-legged it was a plank tipping).
  Traffic knockdowns are unchanged (sideways). Gunshots stagger and floor the
  same way.
- **Feedback**: `smack` on contact, `whoosh` on a miss (audio.js: `punch`
  split at its contact, whose 85 ms of whoosh would have landed late), a
  camera flick (`camKick`, look point up 10 cm and in, squared, decays at 9/s).
- **Armed**: `Fighter.gun`, five boxes in one vertex-coloured geometry (one
  draw, no shadow) parented to the L (right) hand bone; visible on foot with
  rounds, not in water or under a parachute, hidden in a vehicle with the
  body and for activities that pose the hands (`tryInteract`). Firing raises
  a two-handed aim for 1 s after the last shot (rises in 0.09 s): the gun
  hand at the midline, 0.54 m out, at shoulder height along the camera's
  line, the other hand cupping it; the trunk takes 0.85 of the aim's yaw
  (clamped 1.1 rad), standing the body turns to it, moving it follows past
  1.1 rad. **The gun hand is turned so the barrel lies along the aim**, level
  -- on the forearm alone it rode 25 deg high, because the forearm rises from
  an elbow below the shoulder. Recoil kicks the muzzle 0.5 rad up and the hand
  5 cm up and 7 cm back, decaying at 16/s. Probe: wrist 1.45 (shoulders 1.46),
  barrel along the aim to 0.01 vertical before a shot, 0.37 after it.
  **The hitscan starts at the muzzle** (on the press that raises the gun, at
  where the barrel is going: an arm out at shoulder height), from 0.6 m,
  so a pedestrian at arm's length is no longer skipped.
- **Particles had one size.** `PointsMaterial` has no size attribute; the
  effects' `size` attribute was written and never read, so every spark,
  blood drop and smoke puff was the same 1.2 m disc (the first muzzle flash
  was a yellow ball the size of the chest). `effects.js` patches the vertex
  shader to multiply in `psize`; callers' sizes now mean what they say.
  The muzzle flash is points in that one draw, plus a spent case.
- **Walls stop the shot, and so do floors.** The hitscan marches 60 m, but
  only as far as `Player.wallDist` finds a building box (the slab test the
  tank's cast uses, at the barrel's height over the terrain, so a slope does
  not change what a building blocks) or a landmark solid. **The height test
  follows the ground, not the barrel**: a ped (`hitAt`'s `y`) or car counts when
  its feet are within 1.2 m (cars 1.5) of `groundAt` under that point plus how
  high you stand above your own ground. A level test at the barrel's height
  missed anything >1 m lower or >1.5 m higher, i.e. every grade of 6 % or more
  at 10 m -- Capitol Hill was unshootable. A ped on another floor, a deck over
  you or a roof is still out of the line. It used to be 2D and unobstructed:
  a ped behind a building went down. Probe: `node tools/bugrepro/wo6.mjs
  pistol` (+-6/11/18 % at 10/25/40 m, ped and car). Terrain does not stop a
  shot.
- Swimming, a press does nothing. The pistol is in boot's shader warm-up.

**Verify**: verify's "fighting on foot" stands a pedestrian 1.5 m beside you
(90 deg off the heading, 30 deg off the camera): the hit must land on frame
4-9, not before, on that pedestrian, with the heading turned to within 0.25
rad, the fist >= 0.45 m ahead at shoulder height (+-0.15) and back inside
0.35 m by frame 29, and the target staggered. Armed, the body 1.2 rad off the
camera: the gun seen on the hand bone, the hand within 0.12 m of shoulder
height and 0.35 m out along the aim, the barrel along it (dot > 0.9), the body
turned to it, a pedestrian 8 m down the line hit; none in a car; no punch in
the water. `tools/meleecam.mjs <dir> combo|walkcombo|aim|walkaim
[side,chase,front]` shoots the combo or the shots at fixed 1/60 (MELEE_SIDE,
MELEE_DIST, MELEE_HP; `MELEE_PROBE=1` prints the per-frame wrist table and
the hit frames). `docs/melee/` has before | after strips.

## Stunt jumps

Twelve kicker ramps at real places (`src/stunts.js` `JUMPS`): over I-5 at NE
56th St and the I-90 east portals, off Queen Anne (Boston St), Beacon Hill
(Judkins), Admiral and the Pier 89 bluff, into Lake Union between the
houseboats (E Lynn St) and Lake Washington (E Lee St), and on Seattle Center's
lawn, Gas Works' Kite Hill, the Husky E1 lot and Boeing Field's runway. On the
minimap and full map as a wedge pointing the way you jump, orange until landed
clean, then green.

**A ramp is drawn geometry with its own height query, like a lid.**
`installRamps` turns each jump into a record (`city.setRamps`), `city.rampY`
answers the deck and `buildRampMesh` draws it from the same formula, so the car
drives on what is drawn. `groundAt` takes a ramp over the terrain wherever it
is higher and within `DECK_REACH`; the lookup is a byte mask at 32 m, so
groundAt's ~110 calls a frame pay one typed-array read each away from a ramp.
All ramps are one merged mesh on `world.mats.flat`: **1 draw (+1 in the shadow
pass), 2.2k triangles for all twelve.** groundAt measured within noise of master (200k calls, ~52 ms either way; `rampHere` ~16 ns). The profile is `H (A s + (1-A) s^2)`,
`RAMP_A` 0.3: a 5-6 deg toe and the authored angle at the lip.

- **The deck continues the approach's grade, not the ground under the lip.** At
  a cliff edge the ground falls away under the lip; a base line following it
  tilted the kicker down and Boston St launched flat (0.1 m of rise).
- **The base is the highest surface there** (`groundAt(x, z, null)`, ramps
  masked out while it asks), so a ramp can stand on a pier deck, and the walls
  reach down to it.
- **Sides and lip are barrier walls**, banded at "the deck 3 m further back,
  less 0.2": a car's collision reach is ~2.4 m, so that top is under every car
  on the ramp near a wall and over every car on the ground beside it. They are
  appended inside `setBarriers`, so the portal build or its boot-cache restore
  cannot drop them.
- **A ramp at a dead end closes that block to traffic.** Every non-freeway edge
  under a ramp is flagged `noTraffic`: `directedComponents`, `inComponent`,
  `pickNextEdge`, `findPath` and kerbside parking all skip it, so the dead-end
  block is cut off and nothing spawns, routes or parks on it. The others stand
  off-road. A freeway or tunnel edge under a ramp is a siting error, reported by
  the tool (`ON:`), never closed.
- **The run-up and landing are kept clear** (`city.jumpClear`: an oriented
  rectangle per jump). Park trees, street furniture, kerb clutter and lot
  parking skip it; the tool reports any trunk left.

**The flight is `Vehicle.stuntAir`, and only off a ramp.** The ground model
steers the velocity with the body, which in the air would let you turn a jump;
off a ramp the flight path is held in world space, steering spins the body
(`STUNT_SPIN` 2.6 rad/s) and whatever angle it lands at comes back as slide.
Gravity is `STUNT_G` 15 for hang time; crest hops elsewhere keep the old 22, so
nothing but a ramp changed. On the ramp the car rides its CENTRE sample,
stiffly: the four-wheel plane read the ground past the lip with the front pair
and sank the car for the last car-length, and the usual lerp lags ~0.4 m on a
20 deg kicker. Leaving it, the car carries `along speed x deck slope` upward.
**Landing damage is the speed into the ground along its normal**, so a cliff
jump onto a hillside that falls the way you do is survivable; over 20 m/s it
costs `2 x excess`, capped at 40. A splashdown ends the flight at the surface.
In the air the car skips trunks and posts (the store is 2D) but not walls or
landmarks.

**Scoring** (`StuntJumps`, the player's vehicle only): a jump counts from 13
m/s along the ramp at the lip. Distance is lip to touchdown, flat; airtime in
game seconds; spin in 180 deg steps. Pay is `40 + 6/m + 60/s + 150/half-turn`,
x1.5 if clean, +$500 the first time. Clean = not wrecked, out of the water,
moving forward within 25 deg of the heading, under 20 damage; a `water` jump's
clean landing IS the splash. Clean landings tick the unique tally
(`localStorage 'auto-stunts'`, with best distances). Activities' ambient
AIRTIME is suppressed during a stunt so it is not paid twice.

**Bikes and quads pop off the lip, and wheelie** (v123). A light vehicle
(`spec.moto`, `spec.atv`) leaves a ramp with `rampVy * 1.15 + 1 m/s`, plus up
to 3.5 m/s more for pulling the stick back as it goes; before, the quad (then
95 km/h, 26 m/s at the lip against a car's 40-50) cleared the ramps by 1-2 m.
It is now a 125 km/h sport quad. In the air the stick tilts a bike's nose.
On the ground, stick back with the gas on lifts the front about the rear axle
(`v.wheelie`, to 0.42 rad on a quad, 0.55 on a bike, in proportion to the
pull; `sync` raises the centre so the back wheel stays down); steering is
weaker with the front wheel up, and a wheelie over 2 s is announced
(`game.onWheelie`). **The player's contact shadow is its own mesh** now
(`shadowGeo`, `shadowTilt`, made in `setDetailed`): baked into the trim, it
tilted with the body, so a wheelie lifted the dark patch off the road with the
nose and a jump carried it into the air. It follows the road's pitch and roll,
not the wheelie, and hides off the ground. +1 draw for the player's vehicle
only; traffic keeps it baked into `trimGeoW`. The stick's other axis already reached `v.update` as
`pitch` for the planes; cars ignore it. `tools/stuntjumps.mjs --type atv`
drives the jumps on any vehicle type.

| quad, cap 99 | v122 (95 km/h) | v123 |
|---|---|---|
| lip speed | 26-27 m/s | 32-36 m/s |
| distance | 32-73 m | 57-121 m |
| height over the lip | 0.9-7 m | 2.6-18 m |

At full speed the quad now clears Kite Hill's landing into Lake Union (as the
sportbike already did), and the four cliff jumps land it hard, as they do a
car. The full-run `qa-cliff@99` "passed the lip without launching" fails on
master too; the jump passes run alone.

**Slow motion** eases in only for flights predicted over 1.5 s, through the
middle of the flight (off by 80 % of it, so touchdown is at full speed and in
your hands), at 0.55x; `player.stuntCam` pulls the boom 4.5 m back and 1.8 m
up with it. `main.js` scales the whole sim's dt.

**Verify with `node tools/stuntjumps.mjs [ids] [--caps 24,32,99] [--shots
docs/jumps]`**: per jump, a corridor check (buildings, water, roads, trunks on
run-up, ramp and landing; which blocks are closed) and a fixed-dt drive of the
player's car at each speed cap through `player.update`. It fails a jump that
does not launch or land, or is wrecked at 32 m/s. `tools/stuntjumps-page.js`
is the page half; load it into any booted page to re-install edited jumps
(`__sj.install(defs)`) and re-drive them without a reboot.

## WASTED, the siren, and finding a gun

**WASTED takes you to the nearest hospital your roads reach**, not always
Harborview (`RESPAWN_SITES` in main.js): Harborview (places.json's
respawn, kept clear by citygen), UW, Northwest, Swedish Ballard, the VA,
EvergreenHealth and Overlake at their real sites, and clinics standing in
where the real one is off the map or there is none in reach: West Seattle,
Burien, Rainier Beach, Renton, Newcastle, Winslow (Bainbridge, off SR-305
at High School Rd) and Vashon's north end. Nowhere on a road network is
more than ~7 km from one (Port Madison, at Bainbridge's north tip, is the
farthest).

- **Reachable by road is a union-find over the edges** (`roadComponents`,
  made at the first death, ~12 ms on the Mac): Seattle and the Eastside are
  one network (177k nodes), Bainbridge (6.3k), Vashon (1.1k) and the Kitsap
  shore at Southworth (1k) are each their own. `nearestRespawn` takes the
  nearest street node on a network that HAS a hospital -- where you fell,
  or, where no road reaches (Blake Island, mid-Sound, a pocket of private
  drives), the nearest shore that does -- then the nearest hospital on that
  network as the crow flies. One pass over the nodes, ~4 ms a call on the
  Mac, once a death.
- **It is decided where you fell** (`damagePlayer` sets `game.respawnAt`),
  so the WASTED screen says where you are being taken (`#wastedTo`), and
  `doRespawn` goes there. The pause menu's respawn takes the nearest from
  where you stand.
- **Each site is put down like a pickup, stricter** (`vergeSpots`, shared
  with the pickups): the nearest node with a street on it (no freeway, ramp,
  deck or bore), then a spiral out to the first point 2 m clear of every
  carriageway (decks too), 2.4 m of every building, off the water mask and
  every drawn lake, on ground level within 1 m over 2 m. Memoised as
  `respawns` (x, z, node). A clinic sign (post, panel, red cross; 4 draws)
  stands 1.6 m behind each, facing the street, drawn within 400 m; both maps
  mark and name them.

**SIREN** (index.html `.b-siren`, over HORN and out of the grid; G; a pad's
R3) appears only in a police car (`#app[data-police]`, set by
`updateSiren` from `player.vehicle.spec.police`) and switches its siren and
light bar. Presses are COUNTED (`controls.takeSiren`), not read as a held
button: a tap shorter than a frame still counts.

- **Off when you take one**: a commandeered unit's strobes go dark
  (`traffic.policeLights(v, dt, false)`: the lenses shown, in their `cold`
  colours); and off again whenever you leave it, by any door (out, wrecked,
  respawned, warped), because `updateSiren` watches `player.vehicle` change.
  A cruiser bought from the delivery menu gets the same light bar
  (`traffic.lightBar`, which `spawnPolice` builds every unit's with).
- **The sound is traffic's siren voice**: audio.js picks any car with
  `sirenOn` alongside the SPD's (`v.sirenOn` is declared in the Vehicle
  constructor: one hidden class).
- **Traffic yields**: with your siren on, a driven car up to 70 m ahead of
  you, within 9 m of your line and going your way eases off to 40 % of its
  pace and, off residential streets, keeps 0.7 m right through the dodge
  offset (`traffic.sirenFrom`, `stats.yielded`). Not more: shoved right on
  a residential street it met the parked cars at the kerb.
- The SPD's units are unchanged: they strobe (`policeLights(v, dt, true)`
  in `drivePolice`) and wail / yelp as before.

**Pistols are on the maps now** ("how do I get a weapon? I can't find them
anywhere": they were drawn only within 300 m and on no map). 30 pickups: the
fifteen round central Seattle as before, and fifteen more reaching Bainbridge,
Vashon, Bellevue, Kirkland, Mercer Island, Alki, White Center, Northgate,
Lake City, Ballard, Georgetown, Rainier Beach and Columbia City. Each is a
`places` entry (a blue pistol or a green cross, unlabelled on the full map --
thirty labels would bury it), off the maps while it respawns (`off`), and
says hello on foot (`foot`). The pause menu's help says where they are, and
DELIVERY sells a pistol ($300, straight into your pocket).

verify's "WASTED", "the siren" and "pickups on the map": dying in Winslow
wakes you at the Bainbridge clinic and downtown at Harborview (WASTED said
so, alive, on foot, standing on the ground, dry, off the road), every site
on a dry verge, Bainbridge's on its own network, Blake and Vashon to
Vashon's; SIREN hidden on foot and in a sedan, shown in a police car, dark
when taken, a tap strobes it and starts the voice, G stops it, leaving
stops it, traffic ahead yields, an SPD unit still strobes; every pickup on
the maps, none in the water or the road, every hospital marked.
