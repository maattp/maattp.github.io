# Auto: Police, the tank and fire

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Wanted levels (police.js)

The five stars used to be one ramp: more of the same cruisers (up to nine),
cops on foot from three, and a helicopter from four that circled you and did
nothing. Now each level sends something new, and `LEVELS` in `police.js` is
the whole table (caps on what is ACTIVE near you: a unit whose crew is out on
foot still counts as its unit, and its officers as officers):

| stars | cruisers | SWAT vans | cops on foot | SWAT officers | helicopters | who shoots |
|---|---|---|---|---|---|---|
| 1 | 2 | - | 2 | - | - | nobody: they arrest |
| 2 | 3 | - | 3 | - | - | pistols, on foot and out of a stopped car's window |
| 3 | 4 | - | 4 | - | 1 | + the helicopter's marksman (single shots) |
| 4 | 3 | 2 | 3 | 4 | 1 | + carbines (3-round bursts, tracers), a door gunner; vans ram |
| 5 | 4 + 2 | 3 | 3 | 6 | 2 | everything x1.25; roadblocks |

Master at five stars was 9 cars + 6 cops + 1 harmless helicopter = 16; five
stars here is capped at 20 and measured peaking at 12-17. The "+ 2" is the
ROADBLOCK (`block`): every ~28 s while you drive at speed and they can see
you, two cruisers parked nose to nose across a surface junction 140-260 m
ahead, an officer behind each, who get back in and chase once you are past.

**How they fight.** Every police round goes through `Police.fire`: a hit
chance from the weapon's `acc`, falling to half at its range and with your
speed (`1 / (1 + v/14)`); a miss draws its tracer a metre or three past you.
In a car the BODY takes 0.6 of a hit and you 0.22 -- the car is your armour
until it burns (`onCarDestroyed`: 70 damage and out). `WEAPONS` holds the
pistol, the SWAT carbine, the marksman, the door gunner and a mission
suspect's pistol; `tickGun` runs a shooter's trigger (`shootCd`, `burst`,
declared on Vehicle and on every pedestrian). Rifles and the helicopter draw
`fx.streak` (a 7 m tracer travelling at 420 m/s), pistols the old flash
line; both come from one pooled ring of 32 (`effects.js _shot`), where every
shot used to allocate two objects.

**How they move: the pursuit is the planned-path driver.** traffic.js drives
the units (`drivePolice`), asking `police.carTarget` for the target: you
while they see you, spots round where they last saw you while they search, a
point 200 m ahead of themselves once the heat is gone. FARTHER than 60 m a
unit drives traffic's own driver (`driveTraffic`, "How the AI drives": lane
lines, filleted corners, pure pursuit, the IDM), through `pursue`:

- **its turns come off an A* path** to the target (`findPath`, from the end
  of the route's next entry, replanned every 2.5 s, with the route beyond
  that entry): `routeExtend` asks `pursuitEdge` instead of `pickNextEdge`,
  which takes the path's next node, or off the path the exit heading most
  toward the target (and replans soon). A surface one-way may be run the
  wrong way (findPath's 3x cost); a freeway or ramp never.
- **at a pursuit pace** (`v.pursuitV`: 31 m/s a cruiser, 27 a van, the
  search's 20), ignoring the streets' limits, cornering at `A_LAT_POLICE`
  9 m/s^2 against traffic's 3, accelerating at 4.5;
- **yielding to nobody** (no cross-traffic wait) and **driving round** slow
  traffic (under 0.6 x its pace) the way traffic drives round a parked car
  (`v.dodge`), so it does not queue;
- **put back on the graph** (`snapRoute`: the nearest drivable edge at its
  height, the way it faces) when it has no route or is more than 7 m off its
  lane line -- after a ram, a spin, a back-out -- and **backing out** for
  1.6 s when it has gone nowhere for 5 s (`polStuckT`, counted in
  `police.stats.wedged`);
- **braking late** (`BRAKE_POLICE`, 5 m/s^2): traffic's `roadAccel` eases off
  for a corner the moment it is inside the horizon, which held a cruiser to
  ~10 m/s on a downtown grid; a unit ignores any corner that does not yet
  need that much;
- **when the graph will not take it there**: no A* path to the target's node
  (`offGraph` -- a waterfront promenade, a plaza, a node on a piece of the
  graph its directed component cannot reach) it routes to the nearest node it
  can reach (`surfaceNodeNear`), and its crew finish it on foot from up to
  160 m; with no path at all (`noPath`), or getting no closer for 10 s
  (`progD`/`progT`: round a block, into a corner), it drives straight at the
  target from within 160 m for a while and then asks again;
- **spawned off the freeways** where it can be: a unit put on I-5 beside you
  is 240 nodes from you, and drove off half a kilometre before it turned.

Reaching a man standing still (an officer at his side; at four stars a
tactical team out too), five spots across the city at one, two and four stars
(`WC_PROBE_FILE` over wantedcheck): every one of the fifteen inside 60 s,
medians 15 / 25 / 36 s. Without the last four rules: two of the fifteen
never in 60 s. (With the old straight-at-the-node driver, verify's standing
test at two stars sometimes never saw a shot.)

The old driver aimed straight at the next node of its A* path (`heading
error x 1.7`) and braked for anything 10 m ahead: it cut corners into kerbs
and walls, the 6.6 m van wedged, a cruiser queued behind traffic for good,
and at two stars the units sometimes never reached a man standing still.
CLOSE (60 m, or off the road graph) it drives straight at the target: inside
18 m it rams at the level's `ram` speed (a van +4 m/s), or -- if you are not
getting away (`playerSlow`: on foot under 2.6 m/s, in a car under 3) -- slows
to a speed it can stop from and stops beside you, parking-braked, and its
crew get out (`deploy`: two officers from a cruiser, four from a van, as the
level's caps allow). To a target standing still units spawn 70-190 m out
instead of 90-320, and at four stars the vans go out after the first
cruiser. Officers (`peds.spawnOfficer`, walked by `police.footOrders`)
chase, close to arrest at 1-2 stars or hold a stand-off (`hold`, 7-12 m) and
shoot from it at 3+; when you drive off they run back to the car and it
leaves with them (`crew`, counted down in `peds.remove`) -- and stays in for
15 s (`deployCd`, shooting from the window meanwhile): a target crawling away
and stopping again was out, in, out, and a stuck Wedge at five stars had 76
tactical officers spawned round it in a minute (17 in 90 s now, with the car
moved 45 m every 8 s). A van deploys too
when it is held up within 45 m of a slow target for 4 s, and after 7 s on you
even if you are moving. Street cops (`street`) are walked in from the
pavement only to a target on foot or stopped: walked in toward a car at
30 m/s they were left behind and replaced, 53 spawns a minute.

**Seen, tracked, searched.** A unit sees you within 110 m (car), 45 m (on
foot); a helicopter within 95 m of its own ground point, 140 m while it is
following you, or wherever its searchlight's spot passes within 30 m -- and
never while you are under something (`covered`: the highest surface over
your feet is a deck or a bore's roof). Losing sight, they still know where
you went for 2.5 s (`TRACK`: the radio) -- 10 s after a crime (`DISPATCH`: the
call), or units spawned out of sight searched instead of coming, and two
stars took 20 s to find a man standing still -- then the SEARCH starts at the last
point: units drive to spots round it, officers walk to it, the helicopter
sweeps its beam over it, no new unit spawns beside you (it would find you
every time), and the HUD stars flash grey (`#stars.search`). main.js takes a
star every `6 + 3 x stars` seconds of the search (two stars: 12 s then 9 s;
four: 18, 15, 12, 9). Seen again, the clock restarts. In the open under the
helicopter nothing cools.

**Busted.** An officer on foot within 1.5 m of you while you are slow, for
0.7 s; in a stopped car, one at the door (3.4 m) for 1.6 s. BUSTED (the
WASTED card's text, `showEnd`), and `doRespawn` releases you at the Justice
Center (5th and Cherry) fined $100 + $100 a star, your gun confiscated, every
unit cleared (`police.clear`). WASTED is unchanged (Harborview, $200) and
clears them too.

**Rammed is not ramming.** Every police contact added 18 heat, so the units
ramming you at three stars drove your own wanted level up. `onCrash` adds it
only when your car was the faster one into the contact. And a getaway
activity's "3 stars" was `3 x 130 = 390` points, four stars: it sets exactly
the stars it names now (`game.setWanted`).

**The helicopter** is the hangar's Bell 407 (`Vehicle('heli')`, navy,
`setDetailed(true)` for the live rotors, no shadow) flown by police.js, not
by `updateHeli` and not in `traffic.cars`: nothing collides with it. It
arrives from 260 m, flies at up to 42 m/s (a fast car on a freeway outruns
it), orbits 36-50 m off you at ~64 m over the ground with a lead on your
velocity -- the two at five stars on opposite sides -- nose to its beam,
banked into its acceleration, and climbs away when the level drops. Its
search point (aimX/Z) is on you while it sees you and sweeps round the last
sighting while searching; under a deck it lands on the deck (the highest
surface over you), not you through it. **No searchlight is drawn (v193):**
it was an additive cone from the nose to the ground, and in this game's
permanent daylight it read as a strange glowing wedge. Four draws a
helicopter (its tail rotor hidden). The old
one (traffic.js `ensureHeli`) was capsules and boxes in new Lambert
materials, rebuilt every time the level crossed four.

**The SWAT van** (`swat`, `buildSwat`) is built like the ambulance: bonneted
cab, armoured box, navy-black livery, a ram bar standing 30 cm off the nose,
gun ports, running boards, roof rails, a ladder on the rear doors, grille
strobes. SWAT and POLICE are stencilled in GEOMETRY (`stencil`: block
capitals on a 5 x 7 grid, a few quads a letter, in `matte`), because vehicle
parts are vertex-coloured and carry no texture. **A panel's text must run
along the viewer's RIGHT seen from outside**: -z on the +x flank, +z on the
-x flank, -x on the rear, +x on the nose. Mass 3.2, so its rams shove you;
`police: true` gives it the cruiser's V8 and the MISSION button.
**Tactical officers** have their own look pool (`swatVariants`, built in
`warmLooks`): a helmet over the ears with goggles, a plate carrier with
pouches and a pale patch on the back, and a carbine skinned to the right
hand MUZZLE DOWN along the arm -- the walk carries it at the low ready, and
`aimPose` (right arm straight out, left hand to the handguard) then points it
where he faces. Cops aim one-handed. Shots in `docs/wanted/`.

**The light bar** is the SIREN's (`traffic.lightBar`, strobed by
`traffic.policeLights`, which police.update calls for every unit with its
crew, dark once the heat is gone); the SWAT van's sits on the front of its
box, 1.37x wide. Its lens material compiled the first time a cop appeared:
`warmLightBar` builds one for the warm-up frames.

**Hitches.** The warm-up frames also draw the light bar, a mission
suspect's marker and the tracer lines -- which are hidden
until the first shot, and compiled their program mid-firefight on master
too. Nothing else is new to the GPU: the van and the helicopter are vehicle
programs, the officers `pedMat`.

**Measured** with `node tools/wantedcheck.mjs`: a sports car driven by the
getaway driver (`getaway.js`) fleeing the nearest unit from downtown, the
level held, 1/30 s steps, three runs a level (the traffic makes every run
different). The car starts rolling, 12 m short of a node on the street that
leads to it: spawned on the node facing north it began with a U-turn into the
kerb, and a third of the one- and two-star runs were BUSTED there in 6 s.

| stars | the car (three 60 s runs) | car health / yours at the end | units spawned a run | peak active (cap) | the helicopter had you | shots / hits a run | backed out of a wedge (cruisers / vans) |
|---|---|---|---|---|---|---|---|
| 1 | 60 s+ x3 | 100 / 100 | 7-9 cruisers | 2 (4) | - | 0 | 0-1 / 0 |
| 2 | 60 s+, 44 s (BUSTED), 60 s+ | 47-100 / 98-100 | 7-9 cruisers | 3-5 (6) | - | 0-2 / 0-1 | 0-1 / 0 |
| 3 | 60 s+ x3 | 52-94 / 95-100 | 5-15 cruisers | 5-7 (9) | 68-86 % | 14-20 / 0-2 | 0-2 / 0 |
| 4 | 60 s+, 60 s+, 36 s (BUSTED) | 66-90 / 93-96 | 3-5 cruisers, 2-5 vans | 6-9 (13) | 81-95 % | 48-90 / 2-4 | 0-1 / 0-4 |
| 5 | 45 s (wrecked, BUSTED), 60 s+, 60 s+ | 0-48 / 15-81 | 7-11 cruisers, 5-6 vans, 2 roadblocks | 12-14 (20) | 91-96 % | 135-162 / 7-10 | 1-3 / 1-2 |

(The BUSTED runs are the getaway driver wedging mid-chase with units on it.)
No program compiled during the fifteen chases (the harness diffs
`renderer.info.programs` from before them). Standing still on foot you are
BUSTED or WASTED at every level, in 12-38 s; the SWAT team is out at four
and five stars. Hidden 2.2 km away, two stars go at 12 and 21 s, four at 18,
33, 45 and 54 s; three stars in the open under the helicopter: seen 35.7 of
40 s (the rest is its arrival), no star goes. In the Wedge (`spec.armor`) at
five stars the car ends a minute at 184-225 of its 250, you at 81-94; in the
tank, which the getaway driver barely moves, four stars leave it at 29 and
five wreck it in 55 s (507 rounds, 135 hits, the rams doing most of it).

**Phone cost: none measurable.** perfcpu `chase5-rail` puts the car ON RAILS
along the drive-dt route at 14 m/s with five stars held, so both builds cover
the same ground with the same camera (in `chase5-dt` master's officers on foot
boxed the car in by the start and it drove half as far, which made the
comparison meaningless). 8x throttle, each branch run side by side with a
master (v190) run, the planned-path pursuit in place:

| | branch | master |
|---|---|---|
| CPU/frame median, three runs (ms) | 16.4 17.6 17.5 (avg 17.2) | 16.0 17.8 18.5 (avg 17.4) |
| CPU/frame mean, three runs (ms) | 17.1 17.7 17.7 (avg 17.5) | 16.4 18.1 18.6 (avg 17.7) |
| `render` / `traffic.update`, mean (ms) | 9.6 / 4.1 | 10.0 / 4.0 |
| `police.update` | 0.16-0.23 ms | - |
| scene-pass draws | 205-240 | 201-248 |
| police on the street | 8 units, 0 on foot, 2 helicopters | 9 units, 6 on foot, 1 helicopter |

**The searchlight was one pass** (`forceSinglePass`; the cone itself is gone
since v193): three draws a
double-sided transparent material twice (back faces, then front), so the two
cones were four draws. The pair just before the fix measured the branch
+2.8 ms (17.8 vs 15.0 median), +1.7 ms of it in the render submission; the
pair after it, parity (above). Additive light has no order to get right.

Counted directly (`WC_PROBE_FILE`, after a five-star chase) a unit is 5 draws
(three parts, the bar's housing and its lit lens; about 6.4k triangles for a
van and 7.1k for a cruiser), a helicopter 4 (the tail rotor is hidden) + its
cone, an officer 1. The pursuit is driveTraffic per unit, so on a phone a unit
120 m+ off and out of view drives at half rate as far traffic does, and a
unit's A* is kept while it still ends at the target's node and runs through
where the route is going (it was rerun every 2.5 s).

verify's "wanted levels" section steps each level (units by kind against the
table and the caps, tactical officers out at four and at five stars, shots
from two stars and none at one), the cool-down
hidden at two stars (and the stars flashing), three stars in the open under
the helicopter, and a bust at one star through `doRespawn`.

## Police missions (policemissions.js)

GTA's "vigilante". **MISSION** is on the driving pad only in a police vehicle
(`spec.police`: the cruiser and the SWAT van), in a row of its own at column
3 over EXIT, so no thumb position under it moves (SIREN floats over the
pad's top-left corner); `#app[data-police]` is set by main.js `updateSiren`. It is a plain pointerdown listener,
not `data-tap` (player.update takes and drops every tap that is not ENTER);
N on a keyboard. It is lit red while a run is on.

A press (with no wanted level) dispatches level 1: a suspect car spawned on
a street 260-480 m off (no freeway, ramp, deck, bore or water; a residential
one only where there is nothing else; rolling at 12 m/s toward a junction,
not a dead end -- started into a cul-de-sac it spent its first seconds
turning round, and verify once saw one flee 48 m in 8 s), mode
`'suspect'`, driven by `PoliceMissions.drive` (traffic.js calls it for that
mode, and never despawns one): node to node over the street graph, each turn
the one leading furthest from you plus some randomness and never straight
back, flat out on the straights and braking for the turn waiting at the next
node, backing out when wedged, limping at half speed under 30 health; one-ways
either way, never a freeway or a ramp against its flow. A red arrowhead hangs
over it (scaled with distance, so it reads from a block away), a blinking red
diamond sits on the minimap's edge and on the full map, and the objective
line says the level, the clock and the distance.

It is taken down WRECKED (rams or gunfire; its health is the level's, and a
ram costs it 0.7 x the closing speed, so a level-1 car takes four or five
hard ones; under 40 % it limps at half speed) or PULLED OVER (under 1.2 m/s
within 22 m of you for 2.2 s: boxed in, or spun out; near you it does not
back out of a wedge). Ramming a suspect,
wrecking one and a mission's gunfire add no heat. Cleared, it pays, and the
next call comes in 4 s; MISSION again, leaving the vehicle or WASTED ends the
run. The siren the run switched on goes off with it (`_sirenV`; one you had
on yourself stays on), and the objective line is put back only if it is still
the run's own -- a delivery written meanwhile is left alone (the same rule in
firecalls.js and the Duck Tour). `missionSpec(n)`:

| level | suspects | shoots back | clock | top speed | health | pay |
|---|---|---|---|---|---|---|
| 1 | 1 (sedan, hatch, compact) | no | none | 21.5 m/s | 38 | $600 |
| 2-3 | 1 (sedan, SUV, muscle, pickup) | from 3 | 160 s | 24-26.5 m/s | 46-54 | $850-1100 |
| 4+ | 2 (muscle, sports, SUV, EV) | yes | 200 s | 29 m/s up to 34 | 62 up to 110 | $1350 + $250 a level |

plus up to 30 % for time left. A suspect more than 650 m from you for 12 s got
away. The best level is kept in localStorage (`auto-vigilante-best`). If the
run switches the SIREN on (`game.setSiren`, main.js `setSiren`: `sirenOn`,
the light bar strobing, traffic ahead yielding); MISSION leaves it as it is.

verify's "police missions" section: MISSION's visibility on foot, in a sedan,
a cruiser and a van; a run started and its suspect fleeing; wrecked -> paid,
then level 2 with a clock; level 2 pulled over -> level 3; MISSION quits;
leaving the car ends it.

## The tank

**A modern main battle tank on M1A2 lines (generic markings), parked on the
old Naval Air Station apron at Sand Point** -- Magnuson Park, in front of the
hangars (`TANK_SITE` in tank.js, ~(6255, -8170)), nose out to the field. It is
an 'apron' vehicle (never despawned), marked "Tank" on the full map and the
minimap, says hello within 55 m, $25000 from the delivery menu, and kept clear
of the lot's parking (`traffic.keepClear`: the apron is mapped as a car park).
**There is always one there**: every 5 s, with no live tank within 60 m of the
site and you more than 400 m away, `TankSystem.update` parks a new one (the
balloon's rule). Traffic never spawns one. `docs/tank/` has shots.

vehicles.js has the model and the driving; **tank.js** (`TankSystem`) has the
rest: `step(v, dt, input)` runs inside `player.updateDrive` for the tank you
are in -- AFTER the drive and BEFORE `collideWithBuildings`, so it can fell the
street objects and flatten the cars it has driven into before anything pushes
back -- and aims and fires; `update(dt)` runs once a frame for the rounds in
flight, the burning hulks, the crosshair and the home at Sand Point.

### The model: one material, live parts, a belt that is a geometry swap

- **Everything is in the shared MATTE material with vertex colours** (CARC tan,
  darker undersides, a different batch of paint on the skirts, black rubber,
  steel connectors). A tank is flat paint; the per-car clearcoated `paint`
  would make it a toy, and a matte variant of it would be a new program to
  warm. `paint` holds only the four tow eyes. `trim` holds the lamps and the
  driver's periscopes (real glass).
- `buildTank` uses `facet()`: a flat-shaded solid between two rings of points
  (armour is planes; a smoothed loft rounds every edge off it). Hull and
  sponsons are side profiles extruded across x; the turret is a plan wedge
  extruded up with its sides leaning in; skirts are thin profiles, thicker
  over the front three wheels.
- **Three live parts on the player's tank, baked into everyone else's**
  (`buildType` appends them into the `W` geometries at rest: turret ahead, gun
  level, belt at phase 0 both sides): the turret (`TANK.turretAt`, turns about
  the ring), the gun (a child of the turret at its trunnions, `TANK.gunAt`,
  elevates and recoils), and **one side's running gear drawn twice, the right
  side as the left with `scale.x = -1`** (three flips the winding for a
  negative determinant).
- **The belt moves by swapping geometry, not by a shader.** The running gear
  (85 links on the convex hull of the sprocket's pitch circle, the idler and
  the end road wheels -- `tankBelt()` -- plus seven road wheels, the sprocket
  and the idler) is built at `TANK.phases` (4) offsets along the belt: every
  link a quarter-pitch further round, round the sprocket and idler and back
  along the ground, and the wheels turned 1/11 of a revolution per pitch (11
  bolt heads, 11 sprocket teeth), so the cycle closes on itself. `sync()`
  picks each side's phase from its belt travel (`vLong -/+ yawRate x 1.51`, so
  a pivot runs the belts opposite ways). **Past ~half a pitch a frame the true
  phase strobes** (the wagon wheel), so the drawn travel is capped at 1.8
  phase steps a frame: still running, the right way. No new program, no new
  material; the four phase geometries are 3.7k triangles each.
- **Draws: 8 on the player's tank** (paint/trim/matte, the contact shadow,
  turret, gun, two belts) against 12 for a car with articulated wheels; 3 for a
  parked one. Triangles: 10.2k parked (a sedan is 6.8k), ~10k drawn detailed.
- **Out of the tank, the turret swings home before it bakes**: `setDetailed
  (false)` with the turret off-centre sets `tank.stow` and keeps the live
  parts; `_tankParts` slews them back (unaimed for 0.3 s, the wants are zero)
  and bakes when they arrive (~1.5 s from 70 deg). No snap. An 'apron' tank
  settles like a quad (`settles` in traffic.update).

### Driving: skid steering

`spec.tank` sends the yaw to `Vehicle._tankYaw`: **the stick asks for a YAW
RATE, not a wheel angle** -- `TANK.pivot` 0.9 rad/s at a standstill, falling as
`1 / (1 + v / 11)` -- built with a 4.5/s lag (62 t), reversed in reverse like a
car's, and the scrubbing tracks take `|yaw| x v x 0.22` m/s2 off the speed:
a hard turn at speed slows you. Everything else is the car's model: the
longitudinal (acc 2.0, top 65 km/h, 100-0 table 45 m), the grade (`offroad`:
half of it, no grass drag), the ground follow, ramps. Lateral grip 40 (tracks
do not slide). **No handbrake: the HAND BRAKE button is the gun.**

| fixed dt, flat | |
|---|---|
| 0-50 km/h | 5.45 s |
| top | 65.0 km/h |
| pivot on the spot | 51.6 deg/s (360 in 7 s), 0 m drift |
| full lock at full throttle | settles at 52.7 km/h on a 38 m radius |
| 65-0 | 8.4 m |

**Armour is the Wedge's `spec.armor`, one mechanism for both**: 0.12 here
(0.5 on the Wedge) scales every `damage()` (a round striking it still kills
it; one landing 5 m off costs it ~8 %), the crash damage you take in it
(x0.5 x armor: 0.06 of the bare 1.0) and a cop's pistol round. Destroyed, it
goes up like any car (`onCarDestroyed`).

### What it drives through

- **Cars: flattened.** `crush()`: any road vehicle lighter than mass 8 (all
  but the 747) whose body rectangle overlaps the tank's (SAT, nose padded
  0.25 m) while the tank moves (|v| > 0.8 m/s or turning) is `crushed`:
  squashed to 40 % of its height and spread askew, darkened, dead, 'free',
  and **out of the collision pairs** (`resolveCarCollisions` skips `crushed`),
  so the tank drives over it, losing 4 % of its speed and rocking its hull.
  Heat: 6, a police car 30. Standing still against a car it pushes like any
  vehicle (mass 40).
- **Trees, lamp posts, picnic tables: knocked flat, out of the picture.**
  `fell()` takes every street object in the per-chunk store
  (`city.obstacles`) under the hull out of it -- moved to 1e9, so the chunk's
  8 m index stays valid -- with splinters or sparks and a crunch. **And the
  prop disappears**: it is part of its chunk's one merged flat mesh, so
  world.js records each one's run of indices there as it builds
  (`this._fell`: [x, z, i0, i1], kept on the chunk group's
  `userData.fell`), and `hideRange` zeroes that run (degenerate triangles,
  shadow and all). **On a phone the index array is gone after upload**, so
  three gets a shared all-zero array of the whole index's length (it refuses any other size); its update range
  uploads only [i0, i1), and the array is dropped again on upload. A felled
  prop comes back with its collision if the chunk is ever rebuilt.
- **Walls, landmarks and buildings stop it** (barriers and landmark solids are
  other stores; `collideWithBuildings` as for any car).

### The turret, the guns, the crosshair

- **The turret follows the camera** (`step`): its want is the camera's yaw,
  slewed at `TANK.traverse` (measured 57 deg/s); the gun's elevation is the
  camera's pitch (`(0.17 - camPitch) x 0.7`, -9 to +20 deg), corrected for
  the hull's pitch and roll. Driving forward, the chase camera eases behind
  the hull only once you have not touched the look for 3 s (`player.lookT`):
  aiming is not fought. The tank's boom is 12.5 m back and 4.6 m up.
- **The crosshair is honest**: where the bore's line meets something,
  re-cast every third frame (`cast`) and projected; a ring round it runs out
  as the gun reloads (READY / LOADING). DOM, `#tankHud`, made by tank.js.
- **`cast(o, d, maxT)`**: vehicles (their body box, yawed: a 3D slab test),
  people (0.45 m upright cylinders), buildings (their boxes, skipped in a
  bore), then the ground (deck or terrain), water and landmark solids marched
  at 2.5 m and bisected. One reused result object.
- **Main gun** (FIRE): 2 s reload; the round is near-hitscan -- the blast
  lands `t / 900` s later where the cast ended -- with a tracer streak, the
  gun recoiling 0.42 m, the hull rocking away from it, camera shake, a flash
  and smoke ring and dust off the ground. **The blast**: every vehicle within
  10 m takes `150 (1 - d/10)^1.4` (the one it struck, or anything within
  1.2 m, 1000) and a dead one becomes a **hulk** (`wreck`: burnt black,
  `Vehicle.updateWreck` throws it up to ~4 m tumbling about its long axis,
  bounces once, lands on its wheels or its roof, and it burns for 25 s); the
  living are shoved. People within 12 m are thrown down, killed inside 7 m;
  you on foot are hurt inside 12 m; your own tank, caught by its own round,
  takes half through its armour. On water, a plume instead.
- **Machine gun** (MG, coaxial, so the crosshair serves both): 11 rounds a
  second, 7 a round to a vehicle (an SUV dies in ~1.5 s, and becomes a hulk),
  people dropped in a few rounds, a tracer every second round.
- **Heat**: 8 a main-gun round, 2 per five MG rounds, 12 a wreck (45 a police
  car), 20 more a police car caught in a blast; people killed as usual.
- **Nothing is made after boot**: flash, blast, smoke and fire are the shared
  particle pool (effects.js), the streak its tracer lines. verify counts
  `renderer.info.programs` across a shot and its blast: 0 compiled.

### Controls

Touch: the HAND BRAKE button becomes **FIRE** (and the attack colour), HORN
becomes **MG** (`TankSystem.onEnter`, restored on the next vehicle).
Keyboard: J / Ctrl / Space fire, H / K the machine gun. Pad: X or A fire, L3
or RB the machine gun (`controls.read().mg`). ATTACK in a car is the horn; in
a tank it does not honk.

### Sound

`spec.engine 'tank'`: a gas turbine (the Abrams' AGT1500) -- the hydroplane's
turbine pitched down and heavier, spooling over a second or two; a pivot turn
loads it like the throttle (`audioState`). `tracks`: a looped bank recipe of
link slap, road-wheel grind and steel squeal, rate and level from the belts'
speed (`tracks` in the audio state). `cannon`: crack, a chest-deep thump, the
boom rolling for seconds (reverb send 0.7) and the breech's clank. `mg`: one
round, three variants. No tyre lock-up squeal and no plane's wind in a tank.

### Verifying

verify.mjs **"tank"** drives it through `player.update` at a fixed dt: the
bench on flat ground (0-50, top, pivot and drift, a turn at speed, 65-0), the
turret onto the camera, a parked car crushed in its path (speed kept 1.06:
it is still accelerating), a synthetic tree and a real street object felled
(out of the store, its index range rewritten), the main gun at a car 60 m off
(struck, wrecked, thrown 4.2 m, landed; 0 programs compiled), a 1 s MG burst
(10 rounds, SUV 100 -> 30, dead at 2 s), a building it cannot drive through,
and out with the turret at 70 deg (home and baked in 87 frames).
`tools/vehicles.mjs` times it 0-50 against its own band (its own class for
the cornering order). `tools/perfcpu.mjs --runs=tank-dt` drives it downtown
firing both guns (the pursuit it brings included); `tank-calm` holds the heat
at zero, the tank's own cost. At 8x the two tank runs measure within the
run-to-run spread of `drive-dt` (CPU median 12-21 ms against 17-20; worst
frame 27-130 ms against 61-65 in the same sessions): no stall. The line of
fire was the one cost found -- one `buildingsNear` 600 m round downtown and a
2.5 m ground march for the crosshair every frame (`groundAt` 143 a frame) --
so buildings are cast in 80 m pieces and the crosshair marches at 5 m to
400 m, one frame in three (`groundAt` 84). `tools/audiorender.mjs --only
cannon,mg,tracks,engine-tank` renders the sounds (no clipping).

Gaps: a felled prop vanishes rather than toppling; hulks come only from the
tank's guns (the pistol still blows a car up and removes it, as before).

## Fire apparatus and fire calls

**Seattle Fire's rigs stand on the aprons of eleven real stations** (OSM
`amenity=fire_station`, `FIRE_STATIONS` in `src/firecalls.js`; Station 5's
apron on Alaskan Way has no room and stays empty -- fireboats are out of
scope). Every station has a pumper (`fireengine`), six have a tiller ladder
truck (`tiller` + `tillerRear`). They are `'apron'` vehicles, taken like any
parked car, marked on the full map (`kind: 'fire'`, a flame), and replaced
when one has been taken and the player is 350 m away (`refill`).

**The models** (`buildFireEngine`, `buildTiller`, `buildTillerRear`, sharing
`fireCab`): a custom cab-forward crew cab with the front axle under the front
doors, flat face, big screen, chrome grille and extended bumper with a Q2B,
light bar; roll-up aluminium compartment doors (`rollDoor`), pump panel with
gauges and discharges, hose bed with the supply line folded in it, ground
ladders racked on the kerb side, chevrons on the back. The white cab roof, the
reflective band and the gold lettering are **matte, not paint**: paint is
tinted by its material, so nothing painted can be white on a red truck. The
lettering is a squared stroke font of 4-sided tubes (`GLYPHS`, `letter()`),
"SEATTLE FIRE" on the bodies and the unit (E10, L10) on the doors.
Triangles (traffic geometry): engine 8.2k, tiller tractor 6.3k, trailer 5.8k
-- in the bus's range. **3 draws a body, the trailer 3 more**, like the artic.

**The tiller is two vehicles, as the articulated bus is** (see "The
articulated bus (v134)"): the tractor's spec names its trailer (`towed:
'tillerRear'`; the artic's is `'articRear'`), `traffic.spawnAt` makes it,
`Vehicle.follow` places it from the per-trailer `HITCH` table (`ARTIC`,
`TILLER`), the bellows are the artic's alone. The fifth wheel is 0.6 m ahead
of the tractor's drive axle, the trailer's gooseneck overhangs it by 0.95 m
and clears the cab back at full articulation (63 deg stop). The ladder is
bedded the full length over the tillerman's glass cab, its tip 0.75 m past the
tail: 17.3 m bumper to bumper, 18 m to the tip.

- **The tillerman steers the rear axle.** A plain trailer's axle is dragged
  toward the hitch and cuts inside the tractor's path: through a 90 deg corner
  at half lock the trailer's axle ran 2.9 m inside the tractor's line. In
  `follow` the axle moves along its WHEELS, steered `rearSteer` (0.7) x the
  hitch angle and capped at `rearLock` (0.55 rad), kept at its span from the
  hitch (the small root of |H - (A + s d)| = span): 0.73 m. The sign was found
  by measurement, both ways round -- the wrong one makes it worse (7.8 vs 7.6 m
  at full lock).
- **Reversing, he counter-steers** (`rearSteerRev` -1.5): a dragged trailer
  pushed backwards is unstable and went to the 63 deg stop within five seconds
  of reverse with a little lock on; with the counter-steer it held 13 deg.
- An apron tiller's trailer is not re-placed while its tractor has not moved
  (traffic.js `_followK`); apron rigs settle like the quads (`spec.fire`).
- `spec.showR` (340 m) caps an apron rig's draw distance: the 80-lengths rule
  would draw a dozen stations' rigs, 3-6 draws each, from 800 m.

**Driving.** `diesel` gives the heavy diesel and its air-brake hiss at a stop
(and the enter/exit air); `fire` gives the air horns (`HORNS.air`, three deep
sawtooth trumpets). Bench (`tools/vehicles.mjs`, arcade): engine 0-100 13.8 s
(~33 s real), 112 km/h, 100-0 23.1 m; tiller 0-80 9.9 s, 105 km/h, 25.4 m;
lateral 1.8 / 1.7 g, between the bus and the box truck. `minTurnR` 6.0 / 5.2
m. The chase boom is 10 m longer and 1.6 m higher in a tiller.

**WATER** (V, pad RB; a button beside the pad, `#fireBtns`, shown only in a
rig) runs the deck gun on the pump house (`FIRE_MONITOR.fireengine`), or the
waterway at the aerial's heel on a tiller (on its TRAILER,
`FIRE_MONITOR.tillerRear`). It aims where the camera looks: yaw from
`camYaw`, elevation from `camPitch`. A burning flame within 95 m and 0.32 rad
of that aim takes it (`ASSIST`): the pitch is solved for a 32 m/s stream
(`solvePitch`, the low arc; if `march` finds the low arc blocked short of the
flame, the high one). The stream is marched at 50 ms steps against the terrain
and the building footprints; flames within 3.4 m of the arc or 4.5 m of where
it lands are wetted. Where it lands it knocks pedestrians over (`knockDown`,
+3 heat the first time) and shoves cars under 2.6 t.

**MISSION** (M) dispatches a fire call: `pickBuilding` takes a 6-45 m
building 300-1500 m off with a street traffic can reach in front of it
(`inComponent`), and `ignite` puts flames up the face toward that street and
over the roof of a low one. Call k: 3+k flames (max 7), a second building
from call 3 and a third from call 5, a clock of `50 + d/10 + 11 per flame`
seconds scaled down 7 % a call (to 62 %). Wetting takes a flame's hp down at
0.42/s; dry, it creeps back at 0.035/s. Every flame out pays `250 + 125k + 30
per flame + 1 per second left` and the next call comes 5 s later; the clock
running out ends the run; MISSION again stands down. **A call lives in the
rig**, as a police mission does in its cruiser: dying, a respawn or climbing
out stands it down (flames, beacon, `fireTarget`, the objective) in
`mission()`. Probe: `node tools/bugrepro/wo6.mjs fire`.

**Every flame is placed where the street can put it out** (`flameSpots`).
Building boxes abut and overlap along a block, and a flame set 0.6 m in front
of the facade could sit inside a neighbour's box: every stream hit the
neighbour's wall first and the call could not be won -- 2 of 60 swept
buildings, and verify once ran its 120 s with the aim locked throughout,
paid $0. A spot now has to be outside every other building and reachable, by
the same wetting test `cannon()` applies (`reaches`: the impact within 4.5 m,
or the arc within 3.4 m, low arc or high), from a muzzle 3.3 m over the
street point AND 6 m either way along the street (a rig never stops on the
exact spot; a 1 m offset alone failed one in 80). Spots across the face and
up it fill in for refused ones; a building with fewer than min(n, 3) is
passed over by `pickBuilding` (which takes a seeded `rnd`). The cannon picks
the high arc by the same `reaches` test, so placement and play agree. Swept
800 calls (engines and tillers, 4-7 flames, the rig 0-5 m off the point):
all put out.

**SIREN works in a rig as in a police car** (see "WASTED, the siren, and
finding a gun"): `updateSiren` takes `spec.fire` as well as `spec.police`, so
the button shows (`data-police`), G and pad R3 toggle `sirenOn`, traffic
yields and audio voices it. A rig has no `traffic.lightBar`: firecalls.js
shows its own flashing heads (two boxes alternately, one draw) while
`sirenOn`. Dispatching a call switches the siren on through main.js's
`setSiren` (so the button lights), and standing down switches off the one the
call switched on. G was WATER before the toggle; WATER is V now. Map: `game.fireTarget`, a pulsing
red dot; in the world a 160 m beacon until 90 m off, and the smoke.

**What the water costs: about 0.1 ms a frame on the phone stand-in.**
`tools/perfcpu.mjs --runs=fire-spray,fire-call --throttle=8` parks Station
10's engine at a seeded burning building (flames held alight, the camera put
back on the nearest one every frame) with the gun on or off. With
`--wrap=fire.cannon,fire.march`, `cannon()` -- the aim assist's solve, the
64-step `march`, the hit tests and the stream's emission -- measured 0.08-0.14
ms mean a frame at 8x, `march` 0.03-0.08; the whole `fire.update` 0.34-0.38
spraying against 0.27-0.39 not (two alternating runs each: the gun is lost in
the noise between runs, and whole-frame medians, 13-18 ms either way, are
render and traffic). So the march is left as it is: no arc cache. perfcpu
prints per-system MEDIANS too now, and a fire run's state (`spraying`,
`lock`, what the stream hits), so a run with the gun not actually on a flame
cannot pass for a measurement.

**Particles are three Points draws, only while alive** (`Pool`: per-particle
size and alpha in a ShaderMaterial, `uScale` from the camera's fov and the
drawing buffer): water (340, phone 220), flames additive (520 / 300, a glow
particle in six), smoke (300 / 180). `fireSound` is one looped noise source
(spray hiss and rush, the fire's roar and a gated crackle), linked only while
heard. **Nothing compiles mid-play**: `warmMeshes` puts the pools, the beacon
and the lights into main.js's warm-up frames; `renderer.info.programs` was 60
before and after a call with the stream, the flames and the lights all drawn.

verify's "fire apparatus" section: the aprons (off the carriageway, out of
buildings, trailers on the hitch), draws a body, the tiller on Boeing Field's
runway with and without the tillerman (offtracking, articulation, reverse,
hitch, entering the trailer, removing it), stealing a rig from its apron (and its SIREN: shown, on, kept by V, off by G), and
a scripted call on a SEEDED building (dispatch, drive there, spray by the
camera's aim, out, paid, stood down), and 60 seeded calls round the stations,
engines and tillers 5 m either side of the street point, every one put out. `tools/vehshots.mjs` frames a towed rig whole, and `VEH_FAR=
fireengine,tiller ... --street` puts them in the street lineup. Shots in
`docs/firetrucks/`.

Not done: the ladder does not raise; no rigs in traffic.
