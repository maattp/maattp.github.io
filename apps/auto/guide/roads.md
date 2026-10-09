# Auto: Roads, grading and traffic flow

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## One-way traffic

**What the flags mean.** An edge's a -> b is the OSM way's own node order;
build_roads.py never reverses a way. `F_ONEWAY` alone is a -> b only;
`F_ONEWAY | F_ONEWAY_REV` (`oneway=-1`, 2 edges) is b -> a only; roundabouts get
`F_ONEWAY`. **`edgeFlow(e)` (+1, -1 or 0) is the only reader in traffic.js, so
use it.**

**The flags miss I-5's express lanes.** `oneway=reversible` maps to no flag, so
the express lanes (24 motorway + 23 link ways) arrive two-way, and traffic
spawned on them head-on. `edgeFlow` runs all 47 northbound, the afternoon
configuration: an untagged `hwy` named Express / Ship Canal Bridge, or any
untagged `ramp`, which is exact for this extract. If the importer ever gets an
`F_REVERSIBLE` bit, replace the name test with it.

**Traffic keeps to strongly connected regions.** The imported one-way chains
have dead ends: 650 stubs, 18 junctions with no legal way out, 471 at the map
rim. `directedComponents` (an iterative Tarjan SCC at boot) labels each node;
a spawn needs both ends of its edge in one component of 60+ nodes (131k nodes;
the largest is 128k), and `pickNextEdge` only offers legal exits whose far node
is in the car's own component. So a car is never led into a dead end and never
has to U-turn into oncoming flow: 0 dead ends reached in 7 simulated minutes.
The fallbacks are for safety: a car out of sight at a one-way dead end is
recycled, a one-way's only exit sharper than 120 deg is taken anyway, and a
two-way dead end still U-turns.

**One-way lanes span the carriageway, 3.6 m apart** (`LANE_W`, v162), and
**cars collide as their bodies' rectangles** (`boxOverlap` in traffic.js: 2D
SAT on the four body axes, the pair separated along the axis of least
overlap; the circle `hypot(halfLen, halfWid)` is only the broad phase).
`resolveCarCollisions` used to test circles of 0.42 x length -- 2 m for a
sedan -- which touched across 3.6 m, so lanes were 4.2 m and a 3-lane freeway
ran 2 AI lanes; and the circles fell short of a car's nose and tail, so a
queue shoved itself along. **An AI car drives round an unattended car
standing in its lane** (`v.dodge`, set by the forward scan for a `free` or
`parked` car within its lane): shoved circles used to push one along; boxes
do not, and without the dodge a queue sat behind a knocked-out parked car
for good. trafficcheck, 7 sites x 1 min: contacts 127 -> 29 a minute in
total (sr99s 27 -> 2, the pursuit 45 -> 3), stuck cars 2 -> 2. Lanes stay
out of parking (2.2 m) and the shoulder (0.8 m) and inside the narrowest graded
`e.tw`. **An overlapping opposing carriageway owns its half**: SR-99's tubes were
14 m roads 7.5-11 m apart at one level, and laid across full width each tube's
left lane ran 1.3 m from the other's oncoming one, so a side is capped at the
midline to any near-parallel opposing edge within 3 m of height. Stacked 6.6 m
apart, SR-99 no longer trips it past the north mouths. Two-way streets are
unchanged, at 0.48 hw right of centre.

**AI cars see you on foot as far out as they need to stop** (v153). The
scan used to look 10 m ahead at where you were -- well inside a car's
stopping distance at 15 m/s -- so a car saw you step off the kerb too late.
It now looks `v^2/12 + 0.6 v + 6` m ahead (at least 10), at where you will be
by the time it gets there, and brakes fully inside its stopping distance. And
a hit is ONCE (`player.hitCd`, 1 s) and throws you clear to the side you were
on: it was damage every frame of the overlap with a push straight back along
the car's path, so one glancing hit chained into a death. verify's "traffic
and you" steps into the lane 16-28 m ahead of moving cars (master: 20 hits in
40; now 0). **No parked car under drawn water** either: kerb and lot slots
are refused where `traffic.waterAt` (the drawn surface, the boats' query)
stands over the ground.

**Police route legally, except in a pursuit on surface streets.** `findPath`
never takes a freeway or ramp against its flow, and may run a surface one-way
the wrong way at 3x cost, which is what a unit cutting a block does. Inside
55 m they still drive straight at the player.

**A bore's cars spawn in the bore.** `place()` seeds `groundAt` with no height,
so it takes the highest surface, and every car spawned on a tunnel edge drove
the bore's line at street level into the first building (downtown's 4 stuck
cars). `spawnTraffic` re-seeds a tunnel spawn at its node height (a bore's node
`y` is its deck); `spawnPolice` skips tunnel edges.

**Wedged cars are recycled out of sight.** Full throttle, nothing ahead, under
0.5 m/s for 8 s and more than 120 m from the player: removed. Lamp posts beside
lidded ramps and in the I-5 express portal held cars forever, because the
obstacle response took most of their speed every frame. Stuck cars 22 -> 3.
(Posts in portal pits are no longer planted, and a glancing contact keeps its
speed now; see "Vehicles".)

**Measure it with `node tools/trafficcheck.mjs`**, a fixed-dt sampler over 7
sites that judges a car physically: it is against the flow only when no
carriageway under it allows its heading. Deterministic, so two builds compare
like for like. `--dump FILE` writes data for a top-down render, `--shot DIR`
the in-game frames with every moving AI car ringed green or red.

### How the AI drives

The driver used to aim at a point 6-24 m down its CURRENT edge, clamped at
the edge's end, steer `heading error x 1.5`, hold the edge's limit with a
P-controller, and brake 0.35-1 (7-20 m/s^2) for anything within `5 + 1.1 v`
m in a straight 2.2 m corridor. `tools/aidrive.mjs` (below) measured what
that looks like: **junction turns taken at 12 m/s (43 km/h) pulling 21 m/s^2
(2.2 g)**, the aim point jumping sideways at every node (the next edge's lane,
or a different lane count), so a car landed 2-9 m off its lane after a turn
and hunted back; brake/throttle switching 24 times a car-minute behind
another car; and at a standstill the brake is reverse gear, so a queued car
rocked back and forth.

Now a car carries a **planned route** (`v.rt`, up to 10 entries): its edge
and the next few it will take, each with the lane it will hold there. Three
laws:

- **The path is the lanes' centre lines, filleted.** Between two entries the
  two lane lines meet at a vertex, and the corner is a circular arc tangent to
  both (`routeExtend`). Its radius is what the segments leave room for (a bend
  of short OSM segments comes out at the road's own radius), capped at a
  junction at 7 m turning right and 11 m turning left (a left swings wide,
  across the junction). Near-parallel lines join with a jog. **Straight on,
  a car takes the nearest lane, not the same fraction of the width**:
  `laneU` kept a 3-lane fraction onto a 6-lane edge and the car swerved
  3.8 m at the node.
- **Steering is pure pursuit along that path**: the point `3.5 + 0.5 v` m
  ahead (5-20 m), the curvature `2 sin(alpha) / d` that reaches it, turned
  into a wheel angle by the vehicle's own bicycle model (`Vehicle.aiSteer`,
  which shares `steerLock` with the player's steering), so one path is the
  same path for a hatchback and a bus at any speed. A car switches to the
  next entry at the vertex (mid-corner), not at 94 % of the edge.
- **Speed is one wanted acceleration**, the least of: every arc ahead
  (`sqrt(A_LAT x R)`, A_LAT = 3 m/s^2) and every slower street (a ramp off the
  freeway) as the constant deceleration that arrives there at its speed
  (`roadAccel`, out to the stopping horizon, extending the route as it goes);
  the car ahead by the Intelligent Driver Model (1.2 s headway, 2.2 m
  standstill gap, 2 m/s^2 up, 1.3 for a bus or truck); a stop short of a
  Link train, a freight gate or you on foot. `Vehicle.aiPedals` inverts the
  longitudinal model -- drag, rolling, the grade (`v.gradeA`, fed forward
  from last frame) -- into throttle OR brake, never neither while moving
  (that is a fixed 2.4 m/s^2 of engine braking the AI could not modulate).
  **A stopped car holds on the parking brake** (`v.held`) until it wants
  0.4 m/s^2, never on the brake, which is reverse at a standstill.

**The car ahead is found along the path**, sampled every `max(4, scan/10)` m
out to the stopping distance: the straight corridor saw across every
junction a car was about to turn at and waited on whatever stood there, and
on a bend took the next lane's cars. **Cross traffic yields by arrival**:
a moving car crossing the path (more than 60 deg off it; a merge is
left to the car-following) is projected
along its heading 0.8 / 1.6 / 2.4 s; if it will be in the path before this
car gets there (by 0.4 s, or the older car on a tie) this car stops short of
that point. Without it two cars met mid-junction at walking pace, since
neither was in the other's path until both were. Standing things (kerbside
cars, apron vehicles) are only looked at inside 25 m: they are most of the
list, and walking the path for each was most of the scan's cost. An
unattended car in the path is dodged on the side away from it (`v.dodge`,
as before). Two cars waiting on
each other (`v.lead`) resolve by spawn order (`v.prio`, the older goes).
**So does a ring of them** (`waitsOn`): after a crash at a junction the
waiting ran A on B, B on C, C on A, which the pair test never saw, and eight
cars sat on 1st Ave S for good; if a car's lead's leads come back to it
through cars all younger and stopped, it is the oldest and goes.
A car that wants to go and has not moved for a second floors it -- a gentle
2 m/s^2 loses to a post's contact response every frame. **At three seconds
it backs out** (`v.backT`, 1.2 s, wheel reversed so the nose comes round to
the path, as the police units do) and is put back on the graph where it now
stands, the way it faces (`reroute`: `snapRoute`, turned round if that is
against a one-way). Since a crash can spin a car, a car nose-in to another
or to a building at an angle no throttle gets past is no longer only freed by
being recycled out of sight. Re-planning from its OLD edge instead (`rtN = 0`)
sent one that had turned into a junction back toward a lane it could not
reach, and it lapped Stewart St eight times. Not with a section or a
trailer behind: reversing an artic only jackknifes it. And out of sight
(120 m+), a car at rest for 20 s is recycled whatever it waits on: there
are no signals to wait at, so that long at rest is a queue behind a wedge
or a gridlock of three or more.

Every driver keeps a pace of `0.92-1.08 x` the limit (`v.drvK`): a whole
street at exactly the limit drove in formation.

Measured, `tools/aidrive.mjs`, 5 sites x 90 s, car-time weighted:

| | before | after |
|---|---|---|
| speed through 50+ deg turns | 11.9 m/s | 4.6 m/s |
| peak lateral accel in those turns | 21.2 m/s^2 | 3.1 m/s^2 |
| lateral accel, 95th pct | 4.7 m/s^2 | 2.1 m/s^2 |
| lane error mid-edge, 95th pct | 1.37 m | 0.18 m |
| steering reversals / car-min | 6.5 | 3.5 |
| yaw jerk RMS | 1.12 rad/s^2 | 0.30 rad/s^2 |
| brake <-> throttle switches / car-min | 24.1 | 3.6 |
| frames braking over 4.5 m/s^2 | 0.65 % | 0.15 % |
| abs(accel), 99th pct | 7.1 m/s^2 | 2.1 m/s^2 |
| left of centre on a two-way street | 1.6 % | 0.23 % |
| off every carriageway | 1.97 % | 1.92 % |
| car bodies touching / min (all sites) | 0.67 | 0.53 |

trafficcheck (7 sites x 1 min) is level-ish: against the flow 0.10 -> 0.20 %
of samples (cars on two-way edges at junctions near (400, 250) and
(-200, 75) judged over a neighbouring one-way), contacts 3.3 -> 4.0 a minute
(its circle rule: oncoming passes on narrow two-way streets are most of
it), stuck 3 -> 7 of ~180 cars, mostly on I-5 under the convention centre
lid (below). At the 8x phone stand-in, traffic's mean ms/frame over three
alternating passes is within run-to-run noise: drive-dt 2.39 -> 2.50,
foot-dt 2.57 -> 2.49.

Failed alternative: pinching the lane span to the walls found by probing
`barrierHit` along each freeway/tunnel edge (for the cars wedged on I-5
under the convention centre lid). The walls there stand inside the
carriageway at heights off the node chord, the probe missed most of them,
and lane counts changing edge to edge made lane error worse. The wedges are
walls across the roadway (a ramp's centreline runs into one at (519, 6)),
a road-data fix, not a lane one.

## Shimmer and jolt: two things that read as "janky"

**Road markings flashing was two carriageways in the same place.** Two
full-width surfaces on the same ground each paint their own centre line, and the
depth buffer picks a winner per pixel per frame: the road flips between one
yellow line and two. `city.roadCoveredAt()` ranks by width then edge order, and
`meshRoad` skips any 16 m segment a higher-ranked road already paves. Only the
surface is dropped — the edge stays in the graph and traffic still routes over it.

The import made this far rarer — it was 187 near-parallel pairs when hand-drawn
arterials were laid over procedural district grids, and beside the old spawn a
street and a ramp ran 0.7 m apart. Real carriageways don't overlap like that.
**Keep the check anyway**: a motorway and its frontage road still share ground,
and so does a tunnel drawn at surface level under the streets above it.

**A caution about the churn metric below.** Moving the camera 4 mm and counting
changed pixels does *not* isolate this. It reads ~6.6% before and after the fix,
and it read the same with mipmaps disabled entirely — SwiftShader's own sampling
is unstable enough to swamp the signal. It pointed at the albedo map (removing
it dropped churn to 0.7%) and that was a red herring: with the markings gone,
two fighting grey surfaces look identical. **Overlapping geometry is measured on
the geometry**, by asking how much road area is covered by more than one
near-parallel carriageway. Keep the paragraph below for what it does show, but
don't use it to chase flicker.

**Anisotropy is set to the device maximum** (`tex()` asks for 16, three clamps
it). That is standard for road surfaces at grazing angles and worth having, but
it was *not* the flicker fix, despite being committed as one.

**The albedo map is where high-frequency detail lives.** Localise this kind
of thing by moving the camera a few millimetres and counting pixels that change:
a stable scene barely moves. With the road and pavement albedo maps in place,
6.6% of pixels changed from a 4 mm move; with just those maps nulled it fell to
0.7%. Removing the normal or roughness map changed nothing, so it isn't specular
aliasing. Lane markings are 8–12 px lines in a 512 texture seen at a grazing
angle — the canonical anisotropy case — and `tex()` was asking for 8 when phones
offer 16.

**SwiftShader cannot verify texture filtering.** Turning mipmaps off entirely
produces the same churn as leaving them on, which means the software rasterizer
is not honouring mip or anisotropy settings at all. Any filtering change has to
be checked on a real device; do not conclude anything about it from a headless
run.

**Smooth the camera, not the ground.** The lift query has to report the kerb as
the 22 cm step world.js draws, because the two agreeing is the whole contract in
"The one height surface". Ramping the *surface* to make walking smoother was
tried and reverted: it desyncs from the drawn kerb and you sink into the
pavement, which is the same bug as feet-in-the-sidewalk. The jolt belongs to the
camera, so that is where it is damped — vertical follow runs at 4.5 against 14
horizontal, and the ground clamp works against a smoothed floor rather than
snapping to a discontinuous surface. Measured over 900 frames at a fixed 60 fps
step, worst-case camera movement per frame went 35.5 mm → 19.1 mm.

Measure this at a **fixed dt**, driving `updateFoot`/`updateCamera` in a loop.
SwiftShader runs about 4 fps, so real-time traces exaggerate every per-frame
delta by an order of magnitude and are worthless for judging smoothness.

## Junctions, dead ends, bridges

**A street junction is fitted to its approaches, not a square.** It used to be
a square turned to the widest road, as big as that road's half-width, with
every approach strip running on to the node centre underneath it and a square
pavement ring round it cut into pieces. A square cannot fit a skewed crossing,
a T or a narrow road meeting a wide one, and what that looked like was "the way
streets intersect looks so weird": approach strips poking out past the square
as wedges, a patchwork of differently-shaded tarmac in the middle (up to five
surfaces 0-3 cm apart), edge lines running on across the cross street, and
pavement corners meeting their strips at whatever angle the square made.

`citygen.buildJunction(ni)` now shapes it, and `world.meshJunction` draws it:

- each approach ("arm") is cut square across ITS OWN direction at a **mouth**;
  its strip (`meshRoad`), paint (`meshRoadMarks`, to `pm`) and pavement
  (`paveStart`, per side) all stop there, and the junction is the polygon the
  mouths and the arms' kerb lines enclose, fanned from the node;
- between neighbouring arms, by the angle between them: a **kerb radius**
  (`sw + 1.5`, tangent to both kerb lines, pavement following it round) under
  165 deg; a straight kerb from 165-195 deg (the far side of a T), **tapered**
  3 m per metre of step where the road changes width through the junction; a
  **mitre** round the outside of a bend above 195 deg; and where two roads meet
  so acutely that the kerbs cross beyond the arms' share of their edges, a
  sharp **nose** of pavement (a flatiron block) with the polygon run out to the
  crossing point over the overlapping strips;
- mouths are capped at 0.42 of the edge (`tmax`, 0.49 for a nose), so the two
  ends of a short edge cannot meet;
- the mouth carries the strip's own cross-section vertices with its wear value,
  so polish and kerb grime run on across the seam, and the strip runs 0.4 m on
  under the polygon: ending exactly at the mouth left the 1-4 cm step between
  them open, a pixel-wide slit that read as a dotted line across every mouth.

**`NODE_LIFT` is 0.34**, clear of every strip's 0-3 cm bias, so the polygon is
always the top surface where it overlaps a strip. **Graded or elevated arms
keep the old square** (`legacy`): meshGraded/meshViaduct draw them, untrimmed.

**The strip climbs to it** (v157). Those 4 cm were a step at every mouth, up
onto the junction and down off it, at every crossing AND every bend node of
a curved street. Driven at 20 m/s along 40 street chains (63,109 frames at
fixed dt, heading written each frame) it was a +-37 m/s^2 jolt each time:
536 frames over 30 m/s^2, now 32 (a legacy square keeps its step; the ramp
only knows fitted mouths). Each strip rises over the last `MOUTH_RAMP`
(6 m) before a fitted junction's mouth, and `mouthRamp()` (citygen) is the
one formula `roadLift` reports and `meshRoad` draws:

- drawn to 16 mm under the polygon, so the paint (12 mm over the strip)
  stays under it where they meet;
- the 0.4 m run-on under the polygon does NOT climb: ramped, it lay a few mm
  under the polygon (a different chord of the terrain) and junctions.mjs
  counted 1105 stacked samples against 15;
- cells, edge lines, pavement pieces and gutters break where the climb
  starts, so the drawn ramp is the straight line the query reports.

junctions.mjs: sink 230 -> 59, every other count unchanged. The kerb gutter
also moved 6 mm under the lane paint: the edge line lies inside it on any
street under ~9 m of half-width, and at one height whole kerb lines lost the
depth test. None of this is the kerb rule in "Smooth the camera, not the
ground": that ramp moved the query off the drawing, this one moves both.

**The one-height-surface law is kept by construction.** `nodeSurface` asks the
same `junction(ni)` object meshNode draws: point-in-polygon for the tarmac,
and exactly the corner quads that are drawn (`junctionPieces` decides which,
lazily, with the "not on another carriageway" test), plus their verges. That
is the fix the old note below asked for, so a corner quad now wins over the
strip scan (`onPiece`) -- it is only ever drawn where it is the surface.

Measured with **`tools/junctions.mjs`** (19 junctions picked from the graph by
kind -- grid 4-ways, skewed, T, width change, arterial x residential, Queen
Anne and Capitol Hill hills, 5-way; a 0.5 m grid of vertical "rays" against a
triangle soup of the paved meshes, plus oblique, top and eye shots), v92 against
this:

| | square | fitted |
|---|---|---|
| tarmac stacked within 1 cm (z-fight) | 6357 | **615** |
| drawn vs standing height > 10 cm | 764 (1.22 %) | **230 (0.36 %)** |
| nothing drawn beside an approach's kerb | 560 (4.8 %) | **55 (0.5 %)** |
| paint on the crossing / across another approach | 44 | **10** |

**Acute corners clip the strips** (`arm.clip`, half-planes meshRoad applies
per cell with Sutherland-Hodgman in the edge's own (t, o) frame). Past the
mouths both strips used to run on under each other and the polygon: the
darker wedge. A nose clips each strip to the far side of its neighbour's
kerb out to the nose (0.4 m under it, as a mouth is). A corner too acute
even for a nose (two couplets ~25-40 deg apart on short edges, the Denny
triangle) is worse: joining the mouths' facing corners FOLDED the polygon --
the nearer mouth's corner lies inside the other arm's band, behind that
arm's own corner -- so the fill from the node overlapped itself. There the
arm with the nearer mouth yields: its mouth is cut where it crosses the
other's kerb, the polygon runs along that kerb to the other's mouth, and the
yielding strip is clipped to outside the other's band. **Clipping without
the polygon change made holes** (7 -> 124): the region clipped off lay
outside the folded polygon. Stacked tarmac 615 -> **15**, holes 7 -> **3**,
`sink`, `walkOnCw` and `kerbGap` unchanged.

What is left: `walkOnCw` 16 -> 39 is mostly the taper's
pavement over the wider arm's round end, which `onRoad` counts as carriageway
and nothing draws as one. Chunk builds got faster, not slower (the old ring
made ~300 `onRoad` calls a node, at every bend node on every curved street):
`rendercpu --builds --ring=4` 687/559 ms -> 561/441 ms, 2.94 M -> 2.48 M
vertices; perfguard draws unchanged (151 / 219), triangles 1.21 M -> 1.12 M
steady. jank `sink` 99 -> 85, `crossing-clash` / `barrier-on-road` unchanged.
Shots: `docs/junctions/` (`*-map-*` are the classification grids: red a hole,
magenta pavement on a carriageway, blue stacked tarmac, cyan a missing kerb
piece, orange crossing paint; dots are sink samples).

**Pavement must not cross a carriageway, and the ring is where that broke.**
Strips stopped at `nodeRadius` and `meshNode` filled the corner with a square
ring -- drawn as four whole sides, a footpath straight over all four approach
roads. The legacy square still cuts its ring into pieces and drops the ones
covering an approach; a fitted junction's corner quads are tested the same way.

**A dead end is not a junction.** `meshNode` returns early below degree 2.
Otherwise a single street running out to nothing gets a full crossing square and
a kerbed ring sitting on bare ground — the "road to nowhere". `nodeSurface()`
skips the same nodes, because the drawn surface and the lift query have to agree.

**An elevated span is built from two mitred edge lines, not from boxes.**
`meshViaduct` offsets each side of the deck at the *node*, and mitres each span
into its `continuation(ni)` — the best-aligned graded pair at that node,
whatever else meets there — onto one shared point (`deckEdgePoint`). It used to
mitre only where exactly one other deck of the same width met. Deck,
soffit, fascia and parapet are all lofted between those same four corners, so
they stay registered with each other and with the neighbouring span by
construction.

The version this replaced drew a barrier as a `box` per 12 m segment, and a box
can only yaw. Two consequences, both of which were reported as bugs:

- On a climbing ramp the box stays level while the deck rises away from it. At
  `steps = 1` a 117 m span drew one 117 m barrier centred at mid-height,
  stabbing tens of metres above and below the road — the white spears sticking
  out of the freeway.
- Each span offset its rails by *its own* perpendicular, so at a bend the two
  spans' rails started at different points and different angles: "the guardrails
  are slightly angled so they don't touch back to front". Subdividing does not
  fix this — the splay is at the joint, not along the span.

**Only an at-grade junction draws a square.** The square is horizontal at
`n.y + 0.07`, so a sloping deck passes through it — squares at elevated merges
were slabs stabbing through the deck. A graded node that is not an at-grade
junction (ground freeway included) gets no square; its joint is closed by the
mitre. `nodeSurface()` skips those nodes too, so the lift side agrees —
graded ground comes from `groundAt`'s per-sample deck query.

Note the "long thin triangle" probe is *not* diagnostic here: a pier is
legitimately 30 m tall and 2.4 m wide, so it trips any aspect-ratio filter. Judge
deck geometry from a close render alongside and down the deck.

## Street grading: the ground fitted to the streets

**"The roads are really bumpy and go up and down" was the heightfield, not
the road code.** Every street that is not a deck or a graded freeway is drawn
ON the terrain mesh, and the mesh is the 40 m grid split into triangles. A
street running ALONG a hillside crosses that triangulation diagonally, and on
a curved slope -- a bluff edge, a hillside bench -- the triangles it crosses
alternate between the upper and the lower row of vertices. The road saws:
Magnolia Boulevard West rode 43 -> 39 -> 48 -> 37 -> 50 m in 60 m, Bronson
Way in Renton 17 -> 26 -> 17 -> 26 m. The vertices are exact readings of the
DEM; a 40 m lattice of them simply cannot describe the bench the street is cut
into. Measured on the grid along every ground street: 22.8 k grade breaks over
8 % and 6.2 k crests or dips over 1 m, where the street's own line read from
the full-resolution DEM has 0.25 k and 1.7 k.

**The fix is at the raster** (`tools/grade_streets.py`, called by
`build_raster.py` after the lake carve and the airfield, before `height.png`
is written). The DEM tiles are ~6.4 m/px, so sampling them ALONG a centreline
reads the bench. Every 4 m of every ground-level way the road import keeps is
a sample, and the vertices near streets move, in least squares, so that:

| row | per | asks |
|---|---|---|
| absolute (`W_ABS` 1) | sample | the mesh under it = the street's DEM line (smoothed 8 m along the way) |
| curvature (`W_CURV` 12) | sample | the mesh's 2nd difference along the way = the DEM line's |
| stay (`W_STAY` 0.05) | vertex | no change |
| shape (`W_SHAPE` 0.2) | vertex | no change in the 4-neighbour Laplacian, so a pulled vertex is not a pyramid |

`_tri_weights` interpolates exactly as `geo.terrainHeight()` and the mesh do
(split along tx + tz = 1). Solved by CGLS in plain numpy (the import venv has
no scipy), ~200 iterations; no vertex moves more than `D_MAX` 8 m (one past it
is pinned there and the rest re-solve round it). **Nothing at runtime
changes**: every consumer -- mesh, strips, junctions, buildings, peds, graded
freeway floors -- already reads `terrainHeight()`, so the one-height-surface
law holds by construction and the game pays nothing for it. Re-run:
`build_raster.py` then `build_roads.py` (node heights) then `build_lots.py`.

The curvature row is what does it. Fitting heights alone (abs + stay +
shape) could not get below rms 0.47 m and barely moved the humps (6.2 k ->
5.8 k) however weak the regularisers: the lattice cannot pass through every
sample, and least squares spread the miss as a fresh wobble. Asking the mesh
to BEND like the street does trades a little height for smoothness:

| `W_CURV` | breaks > 8 % | humps > 1 m | rms to the DEM line | vertices moved, mean / p99 |
|---|---|---|---|---|
| 0 | 22.8 k -> 23.1 k | 6.2 k -> 5.8 k | 0.79 -> 0.47 m | 0.38 / 2.4 m |
| 4 | 14.2 k | 3.5 k | -- | 0.59 / 4.2 m |
| 10 | 6.6 k | 2.1 k | 0.45 m | 0.70 / 5.1 m |
| **12** | **5.6 k** | **1.9 k** | 0.47 m | 0.73 / 5.3 m |
| 25 | 3.0 k | 1.3 k (below the DEM line's own: flattening real crests) | 0.65 m | 0.92 / 7.7 m |

**What it leaves alone, each learned from a site ridesurvey ranked worse than
master:**

- **Freeways, ramps and the ground under them** (every vertex of a triangle
  they cross, and the ring round it). They are graded at load on the terrain
  as their floor. Fitted alongside at half weight they fought the streets: I-5
  downtown runs in a trench 10 m under the streets on its rim, the vertices
  between belong to both, and the deck streets crossing it (Seneca, Spring,
  Pike) lost their anchors. Left out but free, the streets beside them pulled
  crests up under them (graded freeway acc>30 +27 %).
- **The landmarks** (160 m round each in places.json): they were modelled on
  the DEM as it was. MoPOP sank 1 m into the monorail's passage (verify), the
  Central Library rose 5 m on its block.
- **Bridge and tunnel ends** (50 m): the DEM is bare earth, with no abutment
  fill, and the street mapped as ground runs on over what it reads as the
  bank. Pulled to it, Roosevelt Way fell 19 m at 55 % into the University
  Bridge.
- **Open water** (vertices with half their 50 m wet) and the airfield never
  move. **A shore vertex may**, for the street on the land beside it, but
  every 10 m water cell in a triangle it makes is held (an active set, rounds
  of re-solving) under its water's level - 0.4 m, or no higher than it stood:
  forcing the cells the 40 m grid already stood over their water under it
  dragged the banks down with them.

**And two bugs in the import the survey found on the way**, both fixed at
source:

- **`grade_airfield` graded Beacon Hill.** Its 520 x 1680 m rectangle reaches
  up the hill east of the runway, and its south-east corner set 70 m of
  hillside to the field's 5.2 m: a 65-70 m pit under 38th, 39th and Cecil
  Avenues South and Beacon Avenue, its streets at 40-50 %. It was the worst
  site in the city (304 frames over 30 m/s2 in one 60 m cell). Ground more
  than 25 m over the field is now graded less, and from 40 m not at all.
- **A deck over a creek stood 9.5 m over its pit.** `build_roads.set_heights`
  floored every deck over water at bed + 7 m + 2.5 m, but the bed is only dug
  7 m x the water's share of the 50 m round a vertex: over a creek a few
  metres wide that put the deck ~7 m over the banks its anchors stand on 25 m
  away, a 30-40 % ski jump (NE 145th St, Southworth Drive). The floor now
  scales by the same share (`wet_frac`).

Measured with `tools/ridesurvey.mjs` (6546 km, 25005 chains, 35 M frames),
master against this:

| | master | now |
|---|---|---|
| streets (art/st/res): frames over 30 / 60 m/s2 | 13 065 / 5 057 | **10 165 / 3 505** |
| streets: humps over 1 m in 30 m | 5 738 | **2 139** |
| streets: 3 m grade breaks over 8 % | 13 574 | **4 767** |
| street decks: frames over 30 / 60 m/s2 | 1 764 / 1 088 | **1 352 / 780** |
| street decks: deck captures (jumps) | 64 | **35** |
| freeways, ramps and their decks | 5 817 / 2 761 | 5 820 / 2 760 (untouched) |
| whole city: over 30 / 60, humps, breaks over 8 % | 20 646 / 8 906, 6 238, 14 906 | **17 337 / 7 045, 2 629, 6 106** |
| whole city: 60 m sites worse / better by 20+ | | 65 / 1 254 |

verify: 0 of 36302 viaduct samples fell, 0 of 1082 approaches failed; streets
under drawn water 180 -> 130 (verify's ceiling is 183; master and this booted
the same way). tunneldrive and all six tunnelride rides match master to the
centimetre; jank `sink` 86 -> 58, the rest within one or two; perfguard no
regression; boot at 8x 48.1 s against master's 47.8 s. No runtime or boot cost: the change is
`height.png` (0.52 -> 0.51 MB) and `roads.bin`'s deck node heights.

Before / after, `docs/roads/` (ridesurvey `--shots`, AUTO_GPU=1):
`magnolia.jpg` (the bluff sawtooth), `bronson.jpg` (Renton's roller coaster),
`beacon38th.jpg` (the airfield's pit), `ne145deck.jpg` (the creek ski jump).

### Reading the ride survey

`tools/ridesurvey.mjs [--tag T] [--top N] [--cls a,b]` rides the centreline of
every chain (the straightest same-class continuation through each node,
never a tunnel) at 28 / 18 / 15 / 12 / 10 m/s for hwy / ramp / art / st / res
and dt 1/60, following the ground the way `Vehicle.update`'s vertical block
does (a REPLICA of its arithmetic, not the vehicle: no collisions, ramps or lowDetail,
and on hwy / ramp kinds its air frames are not the real car's -- graded ramps
read 611 here against 42 for the real Vehicle.update; trust it for acc>30 / acc>60
and the site ranking, `tools/hillride.mjs` for the vehicle): four
wheel samples through `groundAt` from y + 0.45 with the centre's `roadLift`,
the bore spike guard, the 18/s follow (fed forward with the floor's steady descent) and
the 22 m/s2 fall over a crest (v202, "A car follows the ground DOWN a
hill" in `guide/vehicles.md`). **If vehicles.js changes how a car follows the
ground, change `ride()` with it.**
A rider is seeded on the edge's own surface. The whole city takes ~60 s after
boot. It writes `tools/data/ridesurvey-<tag>.json`; compare two by 60 m site
to see what got worse, not just the totals -- a totals win hid 157 sites
worse than master, which is how every rule above was found.

- `--at x,z;x,z --range M` prints every chain through those points, one row
  per 3 m: terrain, lift, ground, the wheel-average target, the car, its
  acceleration and AIR. **Read `terr` against `ground` first**: equal means
  draped (a raster problem), a lift of 0 means a deck (a grading problem).
- `--shots DIR --names a,b` (with `--at`) a driver's eye and a raised view
  along the road; run it against master's server too for a pair.
- `RIDE_PROFDEBUG=1` boots with `__profDebug` (gradeRoads' per-sample
  intermediates on `e.pdbg`); `RIDE_PROBE='<expr>'` evaluates after the ride.
- `--legacy` rides the pre-v202 follow (a fall began from rest), for a before/after;
  `--upk K` is the tuning knob for how much of a climb counts at a crest.

**What is left, by class** (worst sites in the json):

- **(fixed v201) A car hopped down a steep street.** The follow never set
  `vy`, so a fall began from rest on every 20 %+ descent: air, land, lerp, air.
  A feed-forward on the steady part of the floor's descent cured it
  (`tools/hillride.mjs`; tunnelride sb/nb unchanged). City-wide, same survey
  (replica): acc>30 17 056 -> 16 310, acc>60 6 887 -> 5 922, airborne frames
  7 122 -> 7 141.
- **Ferry terminals and shore decks** (Winslow Way E, Southworth, Manitou
  Beach Drive): deck ends and the streets meeting them on ground the lake
  carve dug as bed, the class in "Known gaps". An anchor in the dug bed pins
  a causeway's deck 9 m down into the Sound and back up.
- **A portal cutting through a street**: NE 28th St in Bellevue drops 14 m in
  3 m into `cutDepth`'s trench (26 deck jumps in one site).
- **Draped freeway beside portals** (`hwy` / `ramp` kinds, 22 + 32 km) still
  ride at 26 / 15 frames over 30 m/s2 per 1000, ten times graded freeway, and
  are now half of every freeway frame over 30. It is the portal machinery,
  not the raster: see "What is left on the freeways" for the two fixes tried.
- **Downtown deck streets over I-5** (Union, Seneca, Pike): clearance humps
  and deck-to-street steps at the trench rim.
- **junctions.mjs: Queen Anne's hill junction (`15-hillQA`) went from 0 to
  9 tarmac samples stacked within 1 cm**, the steeper fitted ground meeting
  the strip run-on; `09-tee` sink 8 -> 25 and `12-artres` 16 -> 0 (totals
  stack 11 -> 20, sink 73 -> 74). Not chased.
- **SW Admiral Way's deck ends 6 m under the street it lands on** (-3290,
  3355), an underpass trench edge: the bore spike guard holds the car there.
  In master too.
- The deck-floor cone (cap a street deck's imported height by a 15 % climb
  from its anchors) was measured and NOT done: only 434 of 27943 deck
  samples exceed it, and they are real overpasses (NE 45th St, S Holgate St
  over I-5) that need the height.

## Parked cars sit on the slope

**`Vehicle.place()` sets pitch and roll, not just height.** A parked car never
runs `update()`, so left at zero pitch it stays level on a hillside street and
its downhill end is buried. That was the sunken cars on Queen Anne — a 20% grade
needs `atan(0.2)` ≈ 0.2 rad of pitch, and it was getting none. Seattle's real
grades are steeper than the hand-drawn hills were, so this matters more now, not
less.

## Freeway grading: decks and freeway chains are one profile

**An overpass was a slab lying on the street it crosses, and the freeways
draped the DEM.** build_roads.py gives a deck the Laplacian of its neighbours
with a floor of ground + 0.6 m, and the 40 m DEM cannot see an underpass: of
841 deck crossings, 541 cleared less than 5 m and 266 less than 2 m. 107
freeway "bridges" (7.7 km) never rose 3 m above anything — parapets and fascia
lining ground-level I-5 with cross streets running into them. And every
triangle crossing of the draped DEM was a kink in the grade: 5 % of freeway 3 m
steps broke grade by more than 5 %, about 1.5 g through the seat at 30 m/s.

**The unit is the sample graph, not the edge.** Profiling each ~35 m edge on its
own was tried and measured worse (grade breaks 5.62 % -> 9.48 %, 12.21 % with
shared node heights), because smooth within a piece is not smooth across one.
`gradeRoads` in citygen cuts every deck and every ground freeway/ramp edge
(outside `PORTAL_KEEP` 200 m of a tunnel portal) into ~5 m samples that share
one variable per node, and solves them together:

- **Floor** = terrain across the whole width (camber included), the imported
  deck height (water clearance), and `OVER_CLEAR` 6 m over anything a deck
  crosses.
- **Profile** = average_R(cone(dilate_R(floor))), `PROF_R` 20 m. average(dilate(f))
  >= f by construction, so smoothing can never put ground through tarmac or a
  deck into the road below. Plain smoothing put 1.01 m of ground through the
  tarmac.
- **Anchors cap the climb.** The profile is capped by a cone out of the nearest
  at-grade anchor (`GRADE_CAP` 8 %), never below the floor; clearance plateaus
  are clamped at `MAX_CLIMB` 15 %, and the ramp smoothing their edges has to
  obey the same bound or it lands on the pinned node as a cliff (2.8 m in 5 m).
  A smoothstep taper instead squeezed the added height into 2-3 m in 9 m.
- An overpass that would need more than 15 % is refused and left as imported
  (`cityStats.overpassesRefused`).
- **Couple only carriageways running side by side, and blend only what the
  solve left close** (v162). A deck crossing OVER a freeway reads "level"
  with it off its imported node chord and then solves 6 m higher for
  clearance; coupled, the blend averaged the freeway up toward it: 4-5 m
  humps at 20-24 % on I-5 under S Holgate St and beside the I-90 ramps. Two
  guards: a pair must be within ~37 deg (`parallelTo`; at 20 deg the Rainier
  ramps, diverging from I-90 at 20-26 deg, lost their coupling and a portal's
  ground sank from under its piers -- 37 is the angle `tnb` uses), and the
  blend skips a partner solved more than 1 m away (a split-level pair, or a
  ramp climbing over something; the blend is for ~0.2 m). I-5 ground profile
  steps over 8 %: 83 -> 27 (verify's "freeways" holds it under 40). Coupling
  to the neighbour's CLEARANCE-raised floor (not its base) was tried to level
  ramp pairs left 0.6-1 m apart and made barrier-on-road 841 -> 1015:
  reverted.
- **Couple overlapping carriageways to the neighbour's BASE floor, once.**
  Profiled independently they cross along the length (a sawtooth, and a car hops
  to whichever is higher). Coupling to the neighbour's SOLVED height each pass
  ratcheted a cluster up to its highest point: fill 0.68 -> 1.38 m, jolts
  156 -> 668.
- **Camber is capped at `CAMBER_MAX` 6 %**; following the smoothed hillside
  leaned the freeway 15-20 %, so past 6 % the floor takes the rest as fill.
- **Graded node `y` is the road surface** (surface - 0.09, the convention decks
  always had). A node on a fill left at terrain height started every walk
  "at the node" inside the embankment.

**Side-by-side carriageways out of level are split, not stacked.** Lane-count
widths make shoulder-to-shoulder carriageways overlap by metres (~19 km at
0.4-2 m apart, ~15 km at 2-6 m). Under 0.4 m coupling makes them one surface;
6 m and over is a real viaduct. In between, `gradeRoads` trims the upper
carriageway back to the lower one's edge on that side (never under 3 m of
half-width; 14.7 km of sides). `e.tw` / `e.tlo` carry per-sample side widths and
the road below, and groundAt, roadLift's batter, paint, parapets and
`carriagewayAt` all read them. **Node-sharing is not the same road**: a ramp
shares the diverge node and then runs alongside for tens of metres, so only the
joint itself (centrelines under 1 m apart) is excluded from these tests.

**What stands beside a graded road is decided once**, per sample and side, in
`gradeRoads`: berm, wall or nothing (`e.pe`, `e.pwall`). roadLift and
`world.meshGraded` both read it. world.js deciding with its own `carriagewayAt`
query is how a batter lift came to be reported where no batter was drawn.
**A wall is weathered cast concrete, at the tarmac's value** (`meshWall`). It is
the `concrete` facade-atlas family: one tile is one ~5 m panel, with a recessed
joint at the tile edge, 3 x 3 form-tie holes dimpled into the height map, a lift
line, water staining down from the coping and a grimy base. Walls, deck fascia and
the rail's traffic face all draw into the chunk's facade builder with that cell,
tinted mid-grey, so they cost no draw. Copings take the tunnel concrete's value,
so the whole family matches. Under 1.2 m of drop a wall becomes a Jersey barrier
(0.81 m) with a kerb face below. Walls are only as tall as the drop.

**Value matters as much as detail.** One untextured quad read as a blank slab.
The first panelled version still sat at 1.6x and 3.2x the tarmac's linear
luminance (0.242 and 0.366, against 0.152 and 0.114), which made it the brightest
thing in frame after the sky. That is the same visual complaint as "weird
guardrails". It now measures 0.072 on a shaded face and 0.114 in sun, at or under
the tarmac. Relative variation inside the wall rose (sd/mean 0.34 -> 0.62) so the
joints and stains read. Measure a new roadside surface with `tools/values.py` on
a wall crop before judging it by eye.

**Refused overpasses dip the STREET underneath, and only a street.** Where the
road under a refused crossing is a draped street, `city.underpassDepth` cuts a
trench as deep as the missing clearance, eased out on a cosine at 10 %
(6 % / 8 % under a freeway / ramp class). It goes through the portal carve hook
(`buildTerrain` composes it with `cutDepth`; `cellCut` re-tessellates the
cells), and `meshTrenchWalls` stands walls outside the footway past 0.4 m. **A
cut is a footprint, not a road**: it is refused if any bridge landing lies
within footprint + 4 m (by the West Seattle bridge a cut dropped a street 5 m
under another deck's landing), if a junction falls inside the dip, if the walk
leaves the street before it eases out, or past 7 m.

**Don't dip a graded freeway under a ramp.** 110 refusals are freeway over
freeway at interchanges, and lowering the lower freeway was tried three ways,
each worse: clamping to floor - dip brought back the bumpy floor (grade breaks
1.66 % -> 3.07 %); lowering every graded edge in the footprint stepped other
roads' deck approaches (verify approach failures 4 -> 10); and chain-only, the
interchange cuts overlap, so each chain picked up its neighbours' dips (~400 of
522 half-metre jolts). They stay as imported (`cityStats.underpassGraded`).

**groundAt over many short pieces: extrapolate, don't clamp.** A graded road is
one deck surface per sample. `distToSeg` clamps, so past a piece's end its
answer is the end height held flat, and nearest-to-`curY` prefers whichever
flat extension is higher — on a climb, always the piece ahead: the car rode a
smooth profile as a staircase (17.9 % grade breaks against 0.2 % on the profile
itself). Pieces extrapolate along their own grade for 3 m past either end, using
the neighbours' extents (`wl0/wr0/wl1/wr1`) so an untrimmed extrapolation cannot
reach over a trimmed side and catch cars on the road beside it. **An
extrapolation defers to any graded piece that covers the point** -- see "What
you drive on is what is drawn" for why a tie penalty was not enough. A side with
a neighbour in its 1.5 m catch fringe (`e.tnb`, any converging within ~37 deg)
catches nothing past its edge. Narrowing the fringe to `hw + 0.6` everywhere was
tried and reverted: it bought little (182 -> 166 of 1656 samples off the drawn
deck at I-5 downtown) and cost a verify approach by SR-99's north portal.

**Three solver traps, each found as one spike on a single I-5 ride.** Diagnose
them from the solver's own per-sample values. They are published only when
`globalThis.__profDebug` is set, so shipping builds carry nothing.

- **A clearance floor must ease off, not drop.** The grade cone that eases a
  profile down off an overpass plateau was seeded from raised samples only, and
  it pushes a neighbour only when that raises it. Inside the 20 m dilation every
  neighbour already held the plateau height, so the cone never left the window:
  56.09 m fell to 52.62 m in one 5 m sample, a 35 m trough at -11 %. Seed the
  cone from the DILATED plateau.
- **Coupled carriageways must be blended after the solve.** Coupling their
  floors is not enough: the solved profiles still differed by ~0.2 m where they
  overlap, and groundAt took the higher one for a step. Bound the blend by the
  ramped floor below AND the anchor cap above. Bounded by the floor alone, the
  blend re-made cliffs at deck starts and verify's riders went from 0 to 13 falls.
- **A piece past a CONTINUED end yields to the piece that covers the point.**
  Where half-width changes, the previous piece extrapolated 7 cm above the next
  piece's real profile and won. A 0.12 tie penalty settled that case and no
  other (see below); extrapolations are now deferred and dropped within
  `EX_TIE` of a covering piece. Past a FREE end (an anchor, a locked deck) it is
  the only deck there; penalising it there cost SR-99's north approach its
  capture, so uncovered extrapolations still compete.

**Measure the ride and the profile separately.** Comparing `profAt` with
`groundAt` along the same 3 m steps found the staircase in one step; the
combined number only said "worse". Measured with `tools/jank.mjs`: before
grading, as first graded, and after the interchange-contract, verge and lid
fixes (the "graded" column had drifted a little by then -- fwy-bump 1049,
crossing-clash 196, barrier-on-road 1089 -- so compare those against 827 / 194 /
1038; a dash was not re-measured):

| check | before grading | graded | now |
|---|---|---|---|
| fwy-bump (3 m grade break > 5 %) | 3502 / 69668 (5.03 %) | 1044 / 70624 (1.48 %) | **827** (1.17 %) |
| fwy-bump over 8 % (felt as a jolt) | 1739 | 631 | ~400 |
| steps jumping > 0.5 m | 1475 | 512 | -- |
| I-5 ride north of the ship canal, breaks > 5 % | 52 of 518 | 0 of 518 | -- |
| crossing-clash (deck gap < 4.5 m) | 427 / 725 (58.9 %) | 158 / 725 (21.8 %) | 194 |
| barrier-on-road | 1958 / 57270 (3.42 %) | 888 / 56841 (1.56 %) | 1038 |
| bridge (deck buried) | 17 / 6678 | 5 / 6678 | **1** |
| sink | 308 / 6925 (4.45 %) | 295 / 6923 (4.26 %) | **99** |

Most of what is left over 8 % is ungraded freeway beside portals (about 7 % of
its steps), which grading deliberately leaves draped. verify: 0 of 33213 viaduct
samples fall. **verify's approach walk judges a graded deck against its DRAWN
profile**, the same way the riding check does: three "failures" were cars
correctly riding a deck that bows below the straight chord between its end nodes.
The approaches that remain are draped ramps beside portal cuts, where world.js
carves the terrain after citygen fixed the node heights. Cost: +3 draws (terrain tiles carrying underpass cells), ~+1-2 %
triangles; grading runs once at load over ~88k samples.

**Nothing stands up through a deck** (v162, citygen pass 5b). roadFit clears
buildings off carriageways at ground level and leaves bridges alone, but a
box under a viaduct can be taller than the gap: a SODO warehouse's roof
stood 10 cm over SR-99's deck, and cars driving the viaduct hit it as a wall
across the lane, crash after crash. After grading, every building a deck
passes over is brought under its soffit (`cityStats.buildingsUnderDecks`,
33). It runs on every load, so the boot cache needs no new entry.

**A deck may only pick you up if it is at your wheels, and the wheels are
where a vehicle asks from** (v162). `Vehicle.update`, `place()` and the
artic's rear section asked `groundAt` from y + 1.5, so a surface up to 2.4 m
over the lane was "in reach": a ramp running beside a freeway 1.5 m higher,
or a low overpass, captured cars on the carriageway under it and dropped
them off its end. They ask from y + 0.45 now (`REF`; a stunt flight still
uses 1.5). The freeway ride below: 30 m/s2 frames 6246 -> 1462 with the
building cap and this together.

**A deck may only pick you up if it is at your wheels.** `DECK_REACH` is 0.9 m:
`groundAt` used to take the highest deck within `curY + 2.6`, taller than a car,
so driving along ground-level I-5 under an overpass lifted the car onto the
deck and dropped it 3.76 m where the deck ended. 0.9 m is far more than a ramp
climbs between frames (a 10 % grade at 30 m/s rises 5 cm a frame) and far less
than an overpass clears a roof.

### What you drive on is what is drawn

**At a dense interchange groundAt and the drawn deck disagreed on 5-8 % of
samples.** The contract probe -- every graded edge within 450 m of a site, 4
stations x 3 lateral offsets, `groundAt` from its own height + 0.5 against a
ray straight down at road material -- found 134 of 1650 samples more than
10 cm off at I-5 downtown, worst 1.05 m under. A knockout classifier (drop each
nearby surface in turn, see which one groundAt was answering from; the graded
entries in `city.surfaces` carry `.ei` / `.pi` for exactly this) split them
into five causes, largest first:

1. **An extrapolation beat the piece that covers the point** (107 of 262). The
   0.12 penalty settled near-ties only, and a car asks from y + 1.2, so an
   extrapolated grade line a few cm ABOVE the covering piece was nearer and won:
   past the foot of an 8 % piece its line runs 14 cm over the flatter piece it
   hands on to. groundAt now collects extrapolations separately and drops any
   within `EX_TIE` 0.6 m of a covering graded piece in reach; the rest (the
   outside of a bend, a free end) compete as before.
2. **Locked decks under the ground** (58). Decks within `PORTAL_KEEP` keep their
   imported heights, and the importer's bilinear DEM plus a chord over a crest
   left them up to 1 m under the terrain mesh across their width -- a deck is
   flat, so it is the UPHILL edge that must clear. Grass drawn over the deck,
   cars riding the grass. They are raised onto `deckFloor` (terrain across the
   width + `ROAD_LIFT`), the raise dilated along the edge at `LOCK_RAISE_GRADE`
   8 %, capped to 0 at the portal and at an at-grade end, and shared at nodes
   between locked decks. **Each of those three limits was a verify failure
   first**: raising per sample stepped the deck and riders fell (45); raising at
   an anchor stranded 6 approaches; and a node taking the higher of two raises
   was a 1.5 m step at the end of the lower deck.
   **Don't floor NON-locked decks across the width.** It changed which
   overpasses the clearance pass refuses, one came back as a 45 % piece off its
   junction and 6 riders fell -- to buy 2 samples.
3. **`roadCoveredAt` dropped a graded ramp over a road at another level** (~20):
   the level check in "Keeping the roads clear".
4. **A batter swept over the road beside it** (~15, worst 3.7 m). `gradeRoads`
   tested only the first 1.5 m of a batter for another carriageway. The batter
   now stops at the first carriageway it reaches, toe on that road's surface, so
   `meshGraded` and `roadLift` agree by construction.
5. **Catch widths ran wider than the drawn edge.** A graded piece caught to the
   WIDER of its two ends' trims while the drawn edge runs straight between them;
   the extent is interpolated along the piece now (`la/lb/ra/rb`). And `tnb` only
   saw neighbours within 15 deg; it now marks any within ~37 deg (a ramp merging
   at 15-26 deg still has lanes in the fringe), while the trim still needs 15.

| contract probe, > 10 cm off | before | now |
|---|---|---|
| I-5 downtown | 134 / 1650 (mean 4.9 cm, worst -1.05 m) | **18** / 1655 (2.7 cm) |
| Mercer | 37 / 480 (3.8 cm) | **7** / 480 (2.3 cm) |
| I-5 / I-90 | 91 / 3417 (3.6 cm, worst -1.67 m) | **24** / 3417 (3.0 cm) |
| ship canal | 8 / 657 | 2 / 660 |
| I-5 south | 4 / 720 | 0 / 720 |

What is left is mostly decks stacked ~1.1 m over another deck (freeway over
freeway, left as imported), where the probe's ray from y + 1.2 hits the deck
above the car, plus a few junction-square and anchor cases at locked decks.
**Answer "which surface is groundAt standing on" with the knockout, not a
render**: one run names the surface.

### Overpasses: the freeway goes under the street

**A street deck the clearance pass refuses was left lying ON the freeway.**
137 crossings of a street deck over a graded freeway or ramp are refused
(the street cannot climb 6 m in MAX_CLIMB of its anchors), and 117 of them
cleared the lanes by under 4.5 m, 73 by under 2 m, a few by less than
nothing: NE 50th and NE 80th over I-5, Juanita-Woodinville Way over I-405,
Yesler Way. From the driver's seat the deck was a grey slab across the
carriageway at bumper height, and a car within DECK_REACH of it was picked
up onto the street and dropped off its far side (most of the graded
freeway's "crossing-deck" captures). Seattle builds these the other way
round -- I-5 runs in a trench under 45th, 50th and 80th -- so that is what
gradeRoads does after the solve (`fwyDips`):

- **The dip is a fixed shape in graph distance**, not a ceiling: the whole
  footprint under the deck (`c.ext` along the freeway) is lowered by the
  most it needs anywhere there (deck - OVER_CLEAR), eased out at
  `DIP_GRADE` (2.5 % freeway, 5 % ramp) of graph distance, then
  dilated and box-averaged over PROF_R like the profile (never less than
  the raw dip, corners rounded over 40 m). Shaped as a ceiling cone it
  followed the freeway's own grade and on a climb steeper than the cone
  never eased out at all.
- **Each crossing on its own, but a carriageway overlapping a dipped one
  goes down with it** (the levelling's pairs, below). Dipped alone, a ramp
  sharing I-90's pavement at Eastgate ran 3 m under the lanes it overlaps;
  a car on it was carried by I-90 and dropped off the end (+120 on that
  site's score). All-or-nothing per street was tried and halved the dips.
- **Refused** (left as before, `fwyDipWhy`) where the smoothed dip would
  reach an at-grade anchor or a locked deck, or a deck (it was raised for
  whatever is under it); where it needs more than `DIP_MAX` 8 m; where the
  road would end under 9 m or the crossing is over water; where it would
  pitch a freeway past 8 % or a ramp past 10 % that was not already (at
  5 % run-out the I-5 descents south of downtown went to 8-10 %, and
  verify's "I-5 ground profile steps over 8 %" from 37 to 57); and where a
  draped road lies over the freeway's own lanes (the crossing street
  running on as ground past a deck too short for the freeway, the commonest
  refusal before the steep one).
- **The ground is dug to match**: one `pd` record per dipped edge in the
  underpass list (per-sample depth, so the profile decides it, across the
  whole cambered width), carved by the same hook as a street's underpass,
  and `meshTrenchWalls` stands the walls. A draped street on the trench's
  BANK (not over its lanes) is kept out of the carve (`prot`); over the
  carriageway it is dug regardless, or a neighbouring carriageway's lanes
  stayed buried a metre deep. **The terrain cells are found analytically**
  (`underpassDepth.fwyIn`): a ramp's trench is ~10 m wide, the 3 x 3
  samples a 40 m cell is tested at fell either side of it, the cell was not
  re-tessellated and drew raw ground 1 m over the ramp (jank road-poke 1 ->
  3, back to 1).

`cityStats.fwyDips` 32 of the 137 (`fwyDipNoRoom` the rest). Street-over-
freeway crossings under 4.5 m: 117 -> 91 (the dip-less rest are mostly the
refusals for a draped street over the lanes and the steep guard).
Before / after, `docs/overpasses/`: `ne50.jpg`, `ne80.jpg`, `ne145.jpg`,
`yesler.jpg` (driver's eye on the freeway, 70 m back). NE 80th's express
lanes are a narrow cut whose far bank shows as the terrain's steep-slope
tint with no wall on one side; it reads as a cutting, not as a defect, but
it is the weakest of them.

### Overlapping carriageways: one top surface

**68 % of the graded and deck freeway frames over 30 m/s2 were a car on its
own lane answered by a neighbour's surface.** Side-by-side carriageways that
overlap in plan (lane-count widths) were still up to 0.4 m apart after the
solve and blend: pairs the coupling never saw (decks whose IMPORTED levels
differ by more than 2 m and solve together -- the Ship Canal Bridge's
express ramps), the two branches of a diverge still overlapping past their
joint, and coupled pairs the blend's smoothing along each chain pulled
apart again. Too close in level to trim (split levels start at SPLIT_LO),
both are drawn and the higher is the top surface -- and groundAt, asked
from the wheels (curY = y + 0.45), rightly answers the higher one. So a car
was picked up a few centimetres to 0.4 m wherever the pieces overlapped and
dropped where they stopped. Classified per ride frame in a scratch copy of
ridesurvey (the 20 frames before each spike: centre ground off its own
profile, a wheel off, or neither): "centre off" was 600 of 923 graded hwy,
972 of 1374 graded ramp, 100 of 228 hwy deck and 343 of 439 ramp deck spikes.

After the solve, every graded sample whose centre lies inside a parallel
neighbour's CATCH (its lanes, plus the 1.5 m a deck catches past its edge),
with the neighbour 0.02-0.4 m higher at that point (camber included), is
raised to it -- the surface already drawn on top, so nothing visible moves
-- and the raise is eased along its own chain by dilate-then-average over
PROF_R. Raising only, from the heights before the pass (taking a partner's
raised height ratchets, see the coupling), and capped by the anchor cone
only within 60 m of an anchor: on a deck the imported floor already stands
over the cone, and capped there the raise did nothing. Testing only the
neighbour's lanes (not its catch) and skipping node samples each left
half the Ship Canal pairs as they were. The pass reuses the coupling scan's
pairs (`lvPairs`) and the solve's cached windows: its first version scanned
the 100 m edge grid per edge and built 40 m windows, 0.3 s of a desktop
boot. Graded freeway samples where groundAt answers more than 10 cm off the
edge's own profile: 4167 -> 2372 (over 30 cm 1029 -> 782).

### Bore walls are cut back off another bore's traffic

**Under the convention centre the AI wedged on walls standing in I-5's
lanes** (~3,800 car-frames of wall contact a minute at x 520-540, z -150-6,
one across an express ramp's centreline). I-5's mainline, express lanes and
ramps run there as overlapping bores 2-5 m apart in level: too far apart
for the twin rule (`inOtherBore`, decks within 1.6 m), so each bore kept a
collision band from 1.5 m under its deck to its roof, straight through the
lanes of the bore above or below. `world.bandClear` cuts each wall piece's
band back off every other bore whose lanes hold it (top under the deck
above, bottom over the traffic below, 2.6 m), and the drawn wall is clipped
to the same top. This bore's own cars, 1.6 m+ away in level, stay inside
what is left. Measured with a fixed-dt traffic run parked at (530, -60),
traffic cars touching a barrier: 3804 -> 470 car-frames a minute (the rest
is one car queued against a wall at (488, 34), touching, not inside).
tunnelride's six rides are identical to master.

### Freeway grading measured

ridesurvey, master against this (6546 km, 25005 chains):

| | master | now |
|---|---|---|
| freeway, ramps and decks: frames over 30 / 60 m/s2 | 5 820 / 2 760 | **5 529 / 2 595** |
| graded and deck freeway: over 30 / 60 | 3 037 / 1 518 | **2 746 / 1 357** |
| draped freeway beside portals: over 30 / 60 | 2 783 / 1 242 | 2 783 / 1 238 (untouched) |
| streets: over 30 / 60, humps | 10 165 / 3 505, 2 139 | 10 188 / 3 516, 2 139 |
| street decks: over 30 / 60 | 1 352 / 780 | 1 339 / 776 |
| 60 m sites worse / better by 20+ | | 7 / 16 |
| jank fwy-bump (over 8 %) | 736 (339) | **716 (314)** |
| jank barrier-on-road | 520 / 52798 | **456** / 52808 |
| jank crossing-clash (30 of 104 sites) | 150 / 739 | **123** / 739 |

The worst of the seven: an I-405 ramp at NE 10th (11280, -840) 0 -> 44 and
NE Campus Parkway by the University Bridge 127 -> 159. verify: 0 of 36302
viaduct samples fell, 0 of 1082 approaches failed, I-5 steps over 8 % 37
-> 35; tunnelride identical to master on all six rides; perfguard no
regression (triangles +0.4 % steady, the trench walls); boot at 8x 46.4 /
47.1 s against master's best 47.7 s (master's other two runs on the same
machine were 59 s: it is busy, so take the best of each).

### What is left on the freeways

- **Draped freeway beside portals is half of every spike** (2 783 of 5 529
  frames over 30). `PORTAL_KEEP` drapes anything within 200 m of ANY
  portal node, and most of the city's portals are short ramp or street
  underpasses tagged as tunnels at the interchanges (I-405 at NE 8th,
  I-90/I-405, I-5/SR 520, the I-90 lids). Its spike sites, classified: 41 %
  inside a portal cut's dig, 31 % on a lid, 26 % neither. Two fixes were
  measured and reverted:
  - **Drape only what a cut can reach** (graph distance under 200 m from a
    portal, or within a corridor's dig of a bore near one): 54 -> 28 km
    draped, but the newly graded freeway met its new anchors and the cuts
    beside it badly (ramp-graded over 30 1 374 -> 1 750), net -2.5 %.
  - **Fit the raster to the draped freeway** as `grade_streets.py` fits
    streets (samples within 200 m of a tunnel end, weight 1): humps on
    draped hwy 66 -> 44, ramps 119 -> 75, but frames over 30 rose (hwy 1 249
    -> 1 315) and deck jumps doubled -- the spikes are the cut and lid
    machinery's steps (dug roads dropping into another bore's trench, lid
    ends), not the 40 m lattice. That needs the portal code, with
    tunneldrive in the loop.
- **Street decks that still lie on the freeway**: 91 crossings under 4.5 m.
  Most are a draped piece of the crossing street over the freeway's lanes
  (the OSM bridge is shorter than lane-count widths make the freeway); the
  deck would have to be extended over the lanes before the freeway can dip.
- **Diverging branches still overlapping past their joint by more than
  0.4 m** (centrelines under 0.5 m apart are treated as the same road and
  skipped), and decks still apart in level: 888 graded and 826 deck
  samples whose groundAt answers a parallel neighbour (2 758 and 1 389
  before the levelling).
- **Ramps pinned to clearance floors near anchors** keep their crest corners
  (758 profile samples breaking grade by more than 5 %, nearly all within
  60 m of an anchor): unavoidable while the floor binds at MAX_CLIMB.

## SR-99: ride it the way a player does

**Test tunnels with the player's car, entering from the street.**
`tools/tunneldrive.mjs` starts a traffic car at the mouth and steers it by writing
`v.heading`, so it can see nothing about getting IN.

`tools/tunnelride.mjs` works differently. It takes the player's own car ~300 m up
the SURFACE approach and drives it through `player.update` with the input a stick
produces (`input.x`, `input.gasAmt`). Every collision and ground guard a player
meets is therefore one it meets too.

- **Rides:** `sb` (in at Aurora), `nb` (in at SODO), `sb-wrong` and `nb-wrong`, plus
  `sbx` and `sbx-rev`, the SR-99 surface south of the southbound exit, which are
  judged for drops.
- **Stepping:** the default is fixed-dt stepping (1/60 in 120-frame batches), which
  runs a 3.6 km ride in about 3 minutes instead of an hour. `--real` drives the
  page's own loop instead; the two agree.
- **Options:**
  - `--hop` keeps going 40 m past a failure, so one run lists them all.
  - `--scan` classifies the camera's upper view every 50 m.
  - `--stations` / `--shotdone` take the shots, with the HUD hidden.
- **Hit logging:** each sudden speed loss logs what it hit.
- **`captures`:** a twin-deck capture is riding 1.5 m+ off the route's own deck
  for 3 m+ of travel, anywhere portal to portal. Not a failure (the car still
  gets through), but counted: it is the car standing on some other deck.
- **`damaged`:** a wrong-way ride meets every oncoming car, and cars collide as
  circles on a two-lane deck, so it used to end on `car-destroyed` from traffic
  luck alone. Wrong-way rides dodge, keep the car alive and count shunts
  instead, because they judge the geometry.

On master a player could not get through either tube: the southbound stopped 78 m
in and the northbound surfaced through the roof 98 m in. Six causes, found in this
order, because each one hid the next:

1. **Street trees and lamp posts were solid inside the bore.** The obstacle store
   is 2D. Posts on the streets 20-40 m overhead are skipped when the ground at
   their base is 2.5 m or more above the car, the same rule buildings already
   used.
2. **Anything under the tunnel roof is inside.** groundAt's in-bore test used the
   midpoint between deck and ground. A car slightly airborne off a grade change
   landed above it and climbed out through the roof, a little each frame.
3. **The twin tubes overlapped and walled each other's lanes.** OSM draws the
   double-deck bore as two 14 m roads with centrelines 7.5-11 m apart, which
   overlap for ~2.8 km. `world.inOtherBore()` drops any 3 m wall piece, collision
   and drawn alike, that stands inside another tunnel's carriageway with a deck
   within 1.6 m. **It no longer fires on SR-99**, whose decks are now 6.6 m apart
   (see "One bore, two decks"); it stays, and is still right, for ramp forks.
4. **Dive relative to the chord between the END portals, not the nearest one.**
   SR-99's portals sit at 21 m and 0.1 m, so where "nearest" switched, the deck
   jumped +9 -> -11.9 inside 50 m: a 21 m cliff mid-bore.
5. **A second portal must be 150 m+ from the first.** The northbound tube has a
   main-line and a ramp portal ~30 m apart at each end, so its "two portals"
   were one mouth twice.
6. **Twin decks are blended where they overlap**: to their average, fully within
   3 m and fading to nothing at 5 m. With staggered portals they disagreed by
   1.3-2.4 m and the other tube's deck captured the car. **The blend now skips
   SR-99's stacked nodes** (`stackNodes`, in citygen) and any edge carrying
   `e.deck` as a neighbour: blending two decks 6.6 m apart would put both in
   the slab. It still runs for other overlapping tubes.

### One bore, two decks

**The real bore is one tube, southbound on top.** WSDOT's SR-99 tunnel is a
single 17.5 m bored tube, ~15.8 m inside, carrying two 9.8 m roadways (two
3.4 m lanes, 2.4 m west and 0.6 m east shoulders, 4.8 m clearance). The upper
(SB) slab hangs off the lining, the lower (NB) sits on corbels. North portal
west of Aurora north of Harrison; south portal by S Dearborn / Royal Brougham.

The game keeps its 5.4 m box section (`TUNNEL_H`), so road-to-road is
**`DECK_SEP = TUNNEL_H + 1.2 = 6.6 m`** (interior plus slab). **That separation
is the whole point**: at 6.6 m neither deck's walls (banded to deck + 4.9),
roof, groundAt catch (`DECK_REACH` 0.9) nor trench floor (deck - 0.7) reaches
the other, so none of the twin workarounds above are needed.

- **`stackBores` (citygen, at load, before anything reads edge vectors)**
  finds SR-99's two one-way chains, builds a midline where they are within
  22 m, and moves every interior node onto it. At the NORTH mouths the tubes
  are held side by side (`SIDE` = hwU + hwL + 2.5 = 16.5 m; OSM has them
  16.7-18 m apart) for `STACK_SPLIT` 200 m while the lower deck dives, then
  merge over `STACK_MERGE` 120 m. At the SOUTH end the upper deck surfaces at
  its own portal straight off the stack; the lower runs on beneath the upper's
  cutting to its own portal 290 m further south, fading back onto its OSM
  line. Ramps forking off a moved node carry the junction's shift. 159 nodes
  move, worst 5.9 m. Nodes get `n.deck`, edges `e.deck` (`'upper'` | `'lower'`).
- **The upper deck keeps its old profile** (the one the SB rides were proven
  on). The lower is capped at `upper - DECK_SEP` wherever the carriageways
  overlap in plan, from 180 m off its north mouth (so it is already down when
  the merge starts) and 90 m under the upper's approach cutting past its south
  portal. A 10 % cone out of the CAPPED points only carries it back to its own
  profile toward the mouths — a cone over every point also flattened the
  mouth's own 13 % dive and lowered the north exit — and a 25 m smoothing
  touches only the lowered stretch. Lowered up to 8.2 m; NB bottoms at -17.6
  under SODO.
- **The cap is enforced between nodes too.** Both decks are straight between
  their own nodes, and where the upper kinks between two lower nodes (the foot
  of the SB exit ramp, z 1612) the lower chord passed 0.6 m closer.

**Anything that asked "is there a bore here" in plan has to ask per deck:**

| | rule | what broke without it |
|---|---|---|
| `world.inCut(x, z, y)` | a trench whose road runs more than `TUNNEL_H + 1` above this deck is not this deck's cut | the NB bore under the SB exit cutting drew "open" — no roof, walls, lamps: the daylight at NB +200..+300 |
| `cutFloor` | the closing (cap) segment does not dig behind its own start where a bore runs under it | it dug a bowl ~12 m back along a still-climbing deck, 1 m under the SB trench floor and through the NB roof (portalcheck's two SR-99 "sliced bore" samples) |
| groundAt | a tunnel surface caught only through its 4 m bend margin loses 0.6 m to a deck whose own width holds the point | side by side at the north mouths, a car in one tube's right lane rode the other's steeper grade (1.9 m for 7 m) |
| `_tunDeckUnder` | returns the HIGHEST deck under a point | slab headroom measured against the lower deck |
| `world._roofUnder` | headwall piers and mouth cards stop above a **buried** lower roof, only a buried one | over a lower bore's own open cutting the ground is below its roof; raising piers there floated 76 portal walls at I-90/I-405 |
| traffic forward scan | ignores cars more than 3 m above/below, the same band as car-car collision | every car braked for oncoming traffic on the other deck: stopped queues mid-bore |

The `inCut` threshold sits deliberately above 6.0 m: the I-5 Express bore under
a ramp cutting 6.0 m above it keeps the old treatment.

**Long vehicles hold their lane clear of a bore wall** (`hw + 0.4 - (0.7 r +
1.1)` in traffic.js), and **a glancing contact keeps speed in proportion to
the angle** (see "Vehicles"). A bus grazing SR-99's wall side-on used to lose
80 % of its speed per frame and wedge with a column behind it.

### SR-99's north mouths: a street over the bore is its roof

**The cutting ran 45 m past the OSM portals, under Harrison Street.** A cut
walks the bore from its portal until there is `CUT_COVER` (3.5 m) of earth
over the roof, so every headwall stands at the foot of a real cutting. At
SR-99's north mouths the ground is barely above the tubes, so reaching that
cover dug on under Harrison and the street beside it: the lid code patched
the pit with slabs, headwalls stood in clusters with their shoulders over the
neighbouring bore (a beam and a block floating in the cutting), and wherever
no slab reached, groundAt answered the pit floor under drawn tarmac -- a car
fell 10 m to the deck.

In SR-99's portal groups (`streetRoof`: groups holding the stacked decks'
nodes; citywide the rule would reshape 48 cuts whose lids were each tuned
against a regression -- judge those portal by portal first), and since v162
anywhere a FREEWAY crosses a street's bore: the Dexter Way N underpass's cut
dug Aurora 6 m deep across its lanes, a cliff at 28 m/s that no lid had the
headroom to bridge. (Not a ramp bore under a freeway: the I-90 ramps' piers
by Rainier then stood 1.2 m off the ground.)

- **A street crossing the bore ends the cut at its kerb** (footway
  included), when the roof is at most `STREET_ROOF` (1 m) over the ground
  there (the roofs at Harrison's kerb are -0.1 to +0.2 m under ground; a roof
  higher still is a trench the street must bridge, the lids' job). v103 moved
  the end to `STREET_SET` short of the kerb (below). Asking for a metre of cover
  stopped the cuts inside the street, whose north half then dipped into the
  trench.
- **The kerb line is a half-plane nothing past may dig** (`cut.kerb`, in
  `cutFloor`, `inCut` and portalcheck's coverage). The trench's full
  cross-section at its end is ~15 m wide, and where the street crosses at an
  angle its corner reached under the kerb -- tarmac over dug ground, falling
  through the road; clamped `inCut` also answered "open" 8 m under the street,
  a roofless tube with sky above. The cap is 1.5 m, not 14, and the last
  segments' round ends are not dug either: the deepest trench wins, so the
  last real segment's bowl beat the cap's rising floor.
- **The headwall follows the street** (`cut.streetDir`, meshPortalWall):
  every bore's end lies on the kerb line, so they share one station and one
  wall, and its lintel is the street's parapet (street + 1 m, not 2.4 m).
- **The parapet line is a barrier** from 2 m under the roofs up (a car
  stopped against it settles its front wheels over the mouth; a band from the
  roof let it sink under and slide through). Tunnel traffic passes 3.7 m+
  below it. Driven straight north off Harrison, master fell 5 m into the
  cutting; now the car stops at the kerb.
- **A bore is not a carriageway on the surface** (`onRoad(..., includeTunnel)`
  false for the pavement test): pavement was dropped over every bore under it
  while roadLift, which never counts tunnels, reported it -- an invisible
  footway 0.5 m up along Harrison's south side, wherever else a bore runs
  under a pavement too. jank's walk-on-road skips bores for the same reason.

**v103: the cut ends `STREET_SET` (7 m) short of the street, not at its
kerb.** Ending at the kerb left an undug wedge of earth between the headwall
and the street, and the terrain patch is 4 m quads, so its rise was smeared
across the openings: grass covering the mouths. The cut now stops where the
street is 7 m ahead (sampled across the whole corridor width, and the street
picked along the centreline), so at least one quad (`CUT_OVER`) of rise sits
behind concrete. What covers the rest:

- **A cover slab** (`_portalWall`, kind `cover`) runs from the headwall's back
  to the kerb at street height: the street's roof, drawn.
- **Protect zones, not one kerb half-plane** (`cut.protect`, `underStreet`):
  every crossing street near the mouth (not a tunnel, deck, graded or
  portal-incident edge), out to hw + footway + 1 m, is ground nothing may dig
  -- `cutFloor`, `inCut` and portalcheck all skip it. With one kerb from one
  street, a ramp cut dug under Harrison's NORTH footway and a walker sank.
- **The kerb barrier runs along the street's own direction** (its
  perpendicular, oriented toward the street), from the roof - 2 m up. A
  nearest-point normal off a diagonal put it along the wrong street, and cars
  fell off Harrison's north side.

**The bounce inside the mouth was a bore piece's clamped end.** A non-graded
tunnel surface held its end height flat past the end (hw + 4 m of catch), and
on a descending bore that shelf sat over the next piece: the car flew level,
dropped ~1.3 m, and did it again at the next node (+-800 m/s^2). Bore pieces
now extrapolate along their grade for 3 m past a CONTINUED end (`tin0/tin1`:
another bore piece carries on) and give the point up beyond that; a free end
(the portal) stays clamped, because extrapolating there added ~50 fwy-bump
breaks at the lid tunnels. SB mouth: frames over 100 m/s^2 40 -> 16, worst
drop a frame -0.26 -> -0.08 m.

**v104: the cutting's own floor was a staircase too.** `cutFloor` clamps each
corridor segment, so at every joint the lower segment's round end dug a flat
bowl at the joint's depth ~13 m back up the segment before, and the deepest
trench wins: shelf, 1.35 m cliff, shelf, down SR-99's NB entry at SODO, and
the draped road on it bounced the car (720 m/s^2). Past an interior joint a
segment now yields wherever its neighbour covers the point at full depth
(`_segCovers`), **only at a near-straight joint** (within ~30 deg): round a
sharp bend the clamped end is what digs the inside of the turn (yielding
there put 0.41 m of ground over a carriageway at (421, -80)). Frames over
100 m/s^2: SB 14 -> **0**, NB 39 -> 18 (all at the north exit's Aurora deck);
jank fwy-bump 821 -> 772; portalcheck unchanged.

**v108: the chase camera follows the car into a street-ended mouth.** It
used to hang back outside the mouth card with the car inside, so going in
under Harrison the screen went black for most of a second. Three pieces:

- **Portal walls stop the boom** like buildings do (`world._camBlock`, a 32 m
  grid on `city.camBlockGrid`, tested in `clearCamDist` on each box's exact
  height band so a camera in the bore passes under a lintel): lintel, top
  slab, piers, and each **mouth card as a one-way stop**, only while the
  target is on its inner side (`card` = the inward direction).
- **The bore test knows the slab**: under a street-ended mouth's top slab
  the ground is dug, so "carved ground over the car" said open road; a wall
  piece over it (`city.camBlockOver`) counts too, and the ceiling clamp
  tests RAW ground over the camera.
- **No ground inside those bores.** The dug stretch ends at the kerb, and the
  climb back to the street crosses the tube between deck and roof -- the
  card hides it from the road, and a camera inside saw a wall of grass.
  `patchCell` drops quads within 24 m of a street-ended cut's end
  (`_mouthZones`) that intrude into a bore's volume; the top slab covers
  them from above and the lining from inside.

camtunnel 0 of 24, flycam's camera figures unchanged, rides and portalcheck
unchanged. What is left: from inside the NB exit the double mouth's piers
and lintel read as grey blocks round the opening.

**v105: an approach that meets a deck ends at the deck.** The approach ramp
in front of a mouth aims at raw ground 70 m out, whatever it meets on the way.
SR-99's NB exit runs into Aurora's elevated deck ~40 m past the north portal,
and the ramp passed under it 1.7 m low, so the car climbed onto the deck 1.9 m
in 6 m. The walk now samples each approach edge every 3 m for a deck or graded
surface near ground level holding the point (`city.surfacesNear`, groundAt's
grid) and ends the ramp there, at that surface's height. Worst NB north-exit
jolt 396 -> 216 m/s^2. Two things tried and reverted: starting the ramp at the
bore's grade (the SB south exit then stepped 0.86 m), and digging approach
floors only to the road (64 corridors failed portalcheck's coverage).

**The water mask is built in 4 m cells**, skipping only cells whose centre
is water: skipping a whole segment when any sample was wet left the NB entry
cutting's last 30 m under the sea plane.

| north mouths | master | now |
|---|---|---|
| ground dug south of Harrison | 45 m of pit, lids, slab pieces | none |
| drive north off Harrison | falls 5 m into the cutting | stops at the parapet |
| walk Harrison's north footway | falls 7.5 m | stays on it |
| headwalls | 3 staggered clusters | 1, along the kerb |

tunnelride sb / nb / sb-wrong / nb-wrong: 0 captures, 0 hops (unchanged);
sbx / sbx-rev unchanged; portalcheck 0 faults, 0 corridors with ground over
the carriageway (walls 1023 -> 1013: the merged cluster); camtunnel 0 of 24;
jank unchanged (fwy-bump 826 -> 820).

### Cut-and-cover lids: a heightfield cannot hold a road over a trench

**The portal carve digs everything within hw + 7.6 m of a corridor.** That dug
423 surface carriageways that are not a cutting's own approach more than 1 m.
The SR-99 surface south of the SB exit dropped 11-12 m into the NB entry cutting.

A lid is drawn geometry with its own height query, like a deck
(`world.buildLids`, `city.lidAt`, checked at the top of groundAt):

- **Beside a cutting:** a near-parallel road splits at the dividing line, with a
  retaining wall, parapet and barrier on it. Where the trench has 4.6 m of
  headroom, the road runs over it on a bridge slab instead.
- **Crossing a cutting:** the road bridges the trench where there is headroom;
  otherwise it keeps its dip.
- **Slabs come in networks.** A slab that meets an unslabbed dug road at a node is
  withdrawn (iterated), or the other road runs into its side.
- **No slab may stop inside its own lane** over a step of 2 m or more.
- **Slab ends get no barrier,** so a car runs off into the dip rather than into
  a wall across the road.
- **Judge a side's drop by the dig outside it** (raw - carved), not by the
  hillside's natural fall. Otherwise cross-sloping streets wall themselves in.

Every rule exists because the version before it measured worse than master.
Rule sets hit barriers 184, 26, 24, 7, then 5 times.

In the citywide sweep, driving both directions along every dug foreign road (494
runs):

| | master | now |
|---|---|---|
| drops | 393 | **152** |
| barrier hits | 7 | **5** |

It also fixed verify's three stranded viaduct approaches: the 80th Ave SE ramp on
Mercer Island, and an I-405 ramp chain 9-11 m down in lid cuttings. verify starts
each approach from the road (groundAt at raw grade), not terrainHeight, which
under a lid is the trench floor.

**A lid is a road, so it gets everything a road gets:**

- **Lane markings on lid tops.** `meshRoadMarks` paints a lidded road at
  `lidAt + LID_TOP + (MARK_Y - ROAD_LIFT)` in 1 m pieces, so a line follows a
  slab's end down into the dip. The draped markings used to sit under the slab.
- **Nothing planted in a portal pit.** Lamps, trees, clutter, signals and park
  trees skip ground a portal cut digs 0.3 m+ (`cityStats.propsInPit`, 20 at
  boot around the start).
- **The trench wall line is solid under slabs.** Wherever the ledge behind a
  cutting's wall line (hw + CUT_SH + 1.5) is roofed by a lid, the wall line is a
  barrier from under the trench floor to the slab soffit
  (`cityStats.lidLedgeWalls`, `world._ledgeBarrier0/1`). Skipped where the
  ledge is another cutting's carriageway, or an unslabbed surface road's (a dug
  Bellevue street along a ledge ran into one). Driven at the wall under a slab
  for 3 s at full throttle, a car went 42-48 m through into the ledge; now it
  holds 2.3 m inside the wall. The citywide sweep's drops are unchanged by it.
- **Water mask over open cuttings**: every non-cap corridor segment whose floor
  is under 0.3 m gets the depth-only quad. The NB entry cutting at SODO showed
  the sea as a canal beside the SR-99 surface.
- **A slab reaches the kerb where it can** (`buildLids`): columns between a
  slab's side and the kerb join it when they are dug -- but not the road's own
  cutting, not over a cutting's lanes without 4.6 m of headroom, and not over a
  low bore.
- **Where a lid barrier still stands inside a carriageway, the carriageway ends
  there.** Past the SB exit the SR-99 surface (hw 7) runs 2.2 m over the NB
  entry cutting's LANES for ~60 m, 4.7 m down with 3.8 m of headroom, so no slab
  can reach its kerb and the side barrier stands 1-2 m inside the road.
  `e.barW` [+p, -p] is the narrowest clear half-width any lid barrier leaves a
  surface road at its level (its own or another's), and `traffic.laneLat` and
  `meshRoadMarks`' edge line use it the way they use a split-level trim. An AI
  car in the outer lane used to run 1.9 m off the barrier line -- inside a
  sedan's circle plus the wall's 0.8 m half-thickness -- and wedge.
- **A bridge slab has an underside.** A kind-2 lid's top is one-sided road
  material, so from the trench below only its fascias and parapets drew: the
  "floating retaining-wall slabs" over the SB exit cutting were the lid
  fascias of two ramps and a cross street that roof it in part, bars hanging
  5-10 m over the trench floor. `meshLid` draws a soffit 0.7 m under each kind-2
  top, where the fascia's foot already was.

Citywide dug-road sweep after these and the stacking (588 runs): drops 215 ->
215, wall hits 5 -> 2.

### One deck, a lit roof, and no water underground

- **Twin-patch clipping no longer applies to SR-99.** Where overlapping tubes
  share a hole, deck and ceiling cells are clipped (Sutherland-Hodgman) against
  the lower-numbered tube's rectangle (`twinOwner`, decks within 0.25 m). SR-99's
  decks are 6.6 m apart, so each deck draws its own floor, ceiling and lamp
  fixtures the full length of the bore.
- **The pale wedge in the ceiling was the lamp strip.** A 1 m glow strip ran the
  whole bore, 0.8 m over the clamped chase camera. It is now 1.4 x 0.35 m
  fixtures every 6 m. Near-white share of the upper view went 4.1 % -> 0.0 %.
- **Water does not draw for a camera with 1.5 m+ of ground over it** (each water
  mesh's `onBeforeRender`). Once the deck ran smoothly through sea level, the sea
  plane cut the tube in half. No depth-mask height fixed it: every height from
  0.02 m to 1.2 m failed for a camera 0.5-1 m above the sea. The mask stays at
  0.02 m for views from the street into sub-sea cuttings, and skips quads over
  real water. This holds per deck unchanged: both decks have 1.5 m+ of raw
  ground over the camera everywhere past the mouths.
- **v107: the sea plane was one quad, and that is why no mask height ever
  worked.** A 34 km quad runs far past the 9 km far plane, and the depth
  rasterised across a clipped triangle that size is off by more than the
  mask's 2 cm near a low camera: the chase camera over SR-99's NB entry
  cutting at SODO saw the whole cutting flooded, the sea winning the depth
  test against the mask and the road beside it, and the result flipped with
  sub-milliradian changes in heading (a probe pose rounded to 4 decimals
  "worked"). The sea, lakes and canal are tessellated at `WATER_CELL` 530 m
  (64 x 64 for the sea): 12 poses down that cutting all match a render with no
  sea at all, against 1 of 12 failing as one quad. +11k triangles, 0 draws.
  The cutting mask also covers the banks now (`+ CUT_BANK`) and every segment
  with its floor under 1 m, not 0.3, which took out the streaks along the
  banks. **Judge water from the real frame**: `RIDE_SHOT_EVAL='<expr>'` runs
  on the posed frame before each tunnelride shot (hide the sea, paint the mask
  red); a probe pose that is not the ride's exact quaternion can pass.
- **Mitred bore joints meet at the node's height.** The thin light seam across
  the bore (NB deck at z 1667, and at every grade break between two tunnel
  edges) was the mitre: drawn heights came from PROJECTION onto each edge, so
  each piece extrapolated its own grade out to the shared mitre corner, and
  where the grade breaks (+1 % -> -10 % there) deck, wall tops and ceiling of
  the two pieces stood centimetres apart along the joint, showing the clear
  colour through. `meshTunnel` draws heights along the mitred lines (`Ym`: the
  height at t, not at the projection), so both pieces meet at the node's own
  height; groundAt still answers by projection, a few cm off at a joint only.
  **Rays cannot see a crack this thin** -- an image diff of the same pose did
  (51 px changed, all on the two seams).

| ride (`tunnelride.mjs --hop`, traffic) | side by side (81e14ab) | stacked |
|---|---|---|
| `sb` | 0 failures, 0 captures | 0, 0 |
| `nb` | 0, **1 capture** (bore +351, 2.2 m for 11 m) | 0, 0 |
| `sb-wrong` | **1 eject** (bore +3012) + **1 capture** (6.1 m for 29 m) | 0, 0 |
| `nb-wrong` | 0, 0 (car-destroyed at 2961 on the old harness) | 0, 0 |
| `sbx` / `sbx-rev` | 0 drops / 0 | 0 / 0 |
| `nb --real` | **1 capture** (bore +368, 2.43 m for 16 m) | 0, 0 |
| `sb --real` | 0, 0 | 0, 0 |

Wrong-way rows use the dodging, car-kept-alive harness on both builds; shunts
are logged, not failed. Before any of the six causes were fixed, SB stopped 78 m
in and NB surfaced 98 m in. portalcheck: 0/1023 wall faults; sliced-bore samples
went from 2 SR-99 + 2 I-5 Express to **0 SR-99** + 4 Express (see Known gaps).
verify, camtunnel: unchanged (0 falls, 0 through the roof).

**A stall on `sb` was the lid, not the bore.** `sb` used to log one stall at exit
+197 (z 1892, the SR-99 surface on the lid beside the NB entry cutting),
reproducibly: an AI car in the right lane hit a lid side barrier standing inside
the 7 m carriageway and wedged, and the car behind stopped. With `e.barW`
(above) `sb`, `nb`, `sbx` and `sbx-rev` all ride with 0 hops, and `sb --real`
logs only a car-car shunt.

**Order matters.** Each fix exposed the next one. A failed intermediate is not a
failed idea: measure what it exposed first.
