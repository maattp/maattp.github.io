# Auto: Transit

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## The Monorail

**The Seattle Center Monorail runs, and you can drive it** (`monorail.js`,
v116): the 1962 Alweg line from Westlake Center up the middle of 5th Avenue,
round the Denny curve, through MoPOP to Seattle Center, both stations, and
both trains -- Blue "Spirit of Seattle" on the west beam, Red "Spirit of
Century 21" on the east. Every dimension names its source in the header of
monorail.js (the 2003 Landmarks designation report, the structural engineer's
1962 PCI Journal paper, the operator's site). The route is OSM's:
`tools/build_monorail.py` (one ~2 min scan of the state extract) stitches
each beam's ways by shared node into one polyline from Westlake's buffer
(s = 0) to Seattle Center's, with MoPOP's `building_passage` flagged, and
writes `data/monorail.json` with the stations and platforms.

- **It exists before the city.** main.js builds the `Monorail` from its data
  right after the map loads, because citygen needs `clearZones()`: oriented
  rects along both beams and round the stations and ramp, and any building box
  overlapping one whose roof reaches the beam goes (9 today; three stood in
  Seattle Center station). `attach(city)` later re-derives the beam heights
  over the carved terrain; `buildStructure` runs inside `buildLandmarks`.
- **Beam tops are the street + 7.6 m (25 ft), smoothed** as average(dilate),
  so never below it; both beams are held level through each station, and
  bank 8 deg at the Denny curve's 180 m radius, in proportion below it.
- **Columns stand between lanes, not off the road.** The real ones split 5th
  Avenue's lanes (OSM draws two one-way carriageways either side of them),
  so the landmark rule "no solid on a carriageway" is replaced by
  `laneClear()`, which lays lanes out as traffic.js's `laneLat` does and keeps
  every column 1.4 m+ clear of a car's body, and out of junctions; a site that
  fails slides along or sideways. **Their solids are `mono` and AI traffic
  ignores them** (`collideWithBuildings(..., ai)`): a car's obstacle circle is
  0.7 x its radius, 3.5 m for a bus, wider than its body, so a bus in the next
  lane would have hit a column its body clears. You and walkers still hit them.
- **MoPOP has a passage** (landmarks.js `clearPassage`): each skin vertex
  inside the corridor round the beams' midline is pushed out to its edge on
  its own lobe's side, which flattens the faces along the line into the
  valley walls the real building has.
- **Westlake's terminal stands over the sidewalk** between the mall and 5th
  Avenue, because the game's mall box stops ~9 m short of where OSM puts the
  platform; you board and leave it by the street door under its south end (in
  life, the mall's escalators). Seattle Center is walkable: a 1:8 ramp south
  to the platforms, parapets round every open edge.
- **Seattle Center on foot, and the three ways it failed (v117).** (1) OSM's
  three platforms differ in length by up to 0.9 m and the concourse starts at
  the longest: a short one left a hole at the concourse, into the track slot.
  Every platform now runs the station's whole length. (2) In a slot you fell
  THROUGH the walkable roof under it, because `platformAt` answers only the
  highest platform over a point and the platform above masked it; so no one
  may get into a slot: **each slot is filled with a solid from the platform
  edge to its beam** (trains collide with nothing, so they do not notice). A
  thin solid on the edge was slipped past when a long frame slid you along
  it; one reaching past the beam narrowed the platform across the slot until
  you could not walk onto it; one measured to the FAR beam (an outer platform
  sees both) was 12 m wide. (3) Under the ramp is solid, a box per tenth of
  its length topped just under the slab. verify walks all of it.
- **The clear zones are tight to what is built.** A 3 m pad round the
  concourse reached the Armory's east face, 0.2 m past its end, and citygen
  deleted the whole building. verify checks it stands.
- **A train waits for you** (v117): within 350 m of a station and not
  driving a train, the one at its platform holds; with none there or on its
  way, the one at the far end leaves at once. You spawn ~390 m from Seattle
  Center (v158), so the Blue train is there when you walk over.
- **A train is one SkinnedMesh per material with a bone per 9.3 m section**
  (`buildTrainGeometry`, skin index by section range), posed from the beam
  each frame, so the articulated body bends through the curves at **two draws
  a train** (body; trim with the vehicle glass shader). A third, matte draw
  was merged into the body: it measured +2 draws a train for no visible
  change. Its `boundingSphere` is moved with it every frame; a skinned mesh
  culls on that, not on its geometry's.
- **It is a vehicle to the rest of the game** without being a `Vehicle`:
  `MonorailTrain` carries the fields player.js, main.js, hud.js, audio.js and
  activities.js read (`spec.monorail`, `forward`, `vLong`, `x/y/z` at the
  operator's seat, ...). It is not in `traffic.cars`; audio's engine voices
  get the trains in service through main.js `withTrains`, so one passing
  overhead is heard (profile `traction`). No race, getaway or ambient
  airtime counts in one.
- **Driving**: POWER and BRAKE (the last of the handle is emergency, 5.7 mph/s);
  BRAKE held at a stand is a yard move backward. There are no switches: at a
  terminal, POWER with the lead cab facing the buffer walks you to the other
  cab. The doors open only at a platform -- ENTER elsewhere says so -- onto
  the platform at Seattle Center and down to the street at Westlake. Stopping
  with the nose on the mark (1.4 m from the buffer) pays $75 within 0.5 m.
  Buffers and the other train are the only things it can hit; too fast for
  a curve sways the body out and, far too fast, costs health.
- **Service**: the train you are not driving runs itself, 28 s at each
  platform and ~97 s end to end (95 s in 1962). **The gauntlet** from
  Westlake to Olive Way (measured: where the beams are closer than two
  half-widths) takes one train at a time; a train bound for Westlake holds
  at the signal until it is clear, and the signal heads show it. Drive in
  against red and the two sideswipe, as they did in 2005.

`verify.mjs` checks the line (58 columns, beams 5.5 m+ over the street, no
column within 1.3 m of a lane by traffic's own `laneLat`, no building on the
line, MoPOP's skins out of the passage, the ramp's steps), seven minutes of
service at fixed dt (trips 80-140 s, the gauntlet never shared, never over
45 mph) and a run driven from Westlake to the mark at Seattle Center and off
onto the platform. **Cost at the spawn point: +4-5 steady draws (136 -> 140)**,
inside perfguard's tolerance: two guideway halves (split at Denny; 500 m
blocks put four in view), a train, and the Westlake glass. Signs join the
landmark cluster they stand in, and the four signal lamps are one mesh drawn
within 800 m.

**The Seattle Center Leap moved north of the Armory** (v117): the station's
ramp came down across its old lip and it never launched. Re-run
`tools/stuntjumps.mjs` after changing anything near a jump; verify now fails
if any jump's run-up or ramp crosses the monorail.

**`node --check file.js` passed monorail.js with its class unclosed**; the
browser did not. Check a module as one: `node --input-type=module --check <
file`.

## Freight: BNSF's main line (v160)

**Freights run the BNSF main line across the map and you can drive one**
(`src/freight.js`, rolling stock in `src/railcars.js`): the Scenic
Subdivision down from Golden Gardens along Shilshole, over Salmon Bay on the
bascule bridge, through Balmer Yard at Interbay, along the waterfront past
Broad St, under downtown in the Great Northern Tunnel (1.57 km) and the
Seattle Subdivision south through SODO to the map's edge. Both mains where
the line has two -- since v167 that is the whole line across the box (the
27.6 km box ended on single track at both ends, which the section logic below
still handles).

- **The route is OSM's** (`tools/build_freight.py`, from `raw_rail.json`):
  every railway=rail way as a NODE graph (freight switches sit mid-way),
  main line cheapest (crossovers 1.5x, yards and spurs 4x); the first track
  is the shortest path north end -> south end, the second the same with the
  first's ways six times dearer, so it takes the other main where there is
  one. Balmer Yard's stop is the western main's point nearest the yard
  tracks' middle; those tracks are drawn too.
- **The bed follows the ground's AVERAGE, and the ground is cut to it.**
  Link's profile rides over the ground's bumps (dilate, smooth). At a
  freight's 2.2 % ruling grade that put the line on 5-10 m of fill through
  flat Interbay, where the 40 m DEM zigzags 13-22 m every 25 m.
  `setHeights` takes `P.follow = 'mean'` (link.js, Link unchanged); a level
  crossing is pinned to the raw ground there. `carveDepth` cuts the raw
  ground above the formation (1 m under the rail head, flat to 5.5 m either
  side, then a 1:1 bank; a crossing's formation is the road's) through
  `G.setRailCarve`, the portal carve's twin: every consumer of
  `terrainHeight` sees it (roads crossing the line meet the rails), and
  `world.cellCut` re-tessellates the cells it touches. It is settled in the
  constructor, BEFORE citygen -- so the crossings come from the raw road
  graph (`_rawCrossings`), and the bridge's water from `G.drawnWaterLevel`.
  Where the ground is lower, an embankment (earth at 1:1.5). Only a bridge
  OSM maps is drawn as one. The ballast shoulders stop at 3.6 m, 4 m terrain
  quads over the formation cannot poke through them, and a shallow ditch is
  left beside the line.
- **Single track is taken one train at a time** (`sections`, `reserve`): a
  train reserves the section it will enter within 700 m, or stops 40 m short
  (a signal); back in from off the map it waits for its section. The
  readout shows the signal. Two trains are never in one (verify).
- **Level crossings**: 30, each with two gates (mast, lights, crossbuck, a
  striped arm to the centreline on the right of each approach), active from
  25 s before a train to its tail clearing: lights and bell 3 s, then the
  arms come down over 7 s. The arms and lamps are one InstancedMesh each.
  Cars stop at the arm (`blocks`, traffic's scan). **The Salmon Bay Bridge**
  has its Strauss tower and counterweight over the channel.
- **The cars** (`railcars.js`, each cites its data sheet): BNSF ES44C4 (H3:
  orange, black top, yellow stripe, the nose's wings) and CN ES44AC (black
  over red, white stripe, the CN logo); three-bay covered hoppers (BNSF, CN),
  loaded aluminum coal gondolas, DOT-117 tank cars (UTLX, TILX, GATX; UN 1267
  / 1987 placards), 50 ft plate F boxcars (BNSF, CN). Built in car-local
  metres into body / trim / decal builders; the lettering is one canvas
  atlas (`railDecals`, 2048 x 1536 -- **every cell must fit**: at 1024 tall
  the last dozen, the nose's wings among them, fell off the canvas and drew
  nothing). A train is one SkinnedMesh per material, a bone per car (vertices
  in the car's own frame, the bone between its trucks): 3 draws, ~57k
  triangles. Two trains of 20 (2 locomotives + 18), ~360 m and ~2,450 t.
  Cuts stand on Balmer Yard's tracks (merged, solid).
- **Service**: 50 mph, 30 in the tunnel, 25 past the yard, curves at 0.7
  m/s2 unbalanced; a crew change at Balmer Yard (75 s, held while you walk
  up), off the map at an end and back on the other main. They sound the
  crossing pattern (long, long, short, long, the last held into the
  crossing) and ring the bell, and blow short urgent blasts for anyone on the
  track ahead, braking once inside their stopping distance -- which is long.
- **Driving** (ENTER at the lead cab, stopped; or ENTER at the yard to call
  one in -- it is moved up the line to 900 m out if the track is clear):
  hold POWER to notch up (8 notches), BRAKE drops the notch then applies the
  air (graduated release when you let go), a double tap of BRAKE is the
  emergency; BRAKE held at a stand flips the reverser; POWER at a stand at the
  map's edge changes ends. Tractive effort per unit is the lesser of adhesion
  and power (x1.7 arcade), gravity is averaged along the whole train. 0-40
  mph in ~70 s, 50 mph top; 38 s to stop from 49 mph. The horn button is
  held (a K5LA), and sounding it before a crossing pays $15. In the tunnel
  the camera goes into the cab.
- **Flagging one down** (`flagDown`, reached through `onWait`, so player.js
  is untouched): a freight is almost always found moving, and ENTER beside a
  moving one used to do nothing at all. Now, on foot, ENTER within 15 m of
  the lead cab, beside the line up to 600 m ahead of it, or within ~8 m of
  any car's side stops it for you ("The engineer is stopping for you", or,
  beside a car, "Climb up at the lead locomotive's cab — the front of the
  train"), and an orange beacon stands over the cab. Standing ON the track
  ahead only gets "Get off the track!" (it is already blowing for you,
  `_guard`). The stop (`FreightTrain._flagStep`, `flag.phase`) is ARCADE,
  because a real one kept a player standing 132 s (36 s to stop at full
  service, 362 m past, a 10 mph set-back): `stop` plans the cab to your spot
  at 1.1 m/s2 on an emergency application of `FREIGHT.flagStop` (1.3 m/s2,
  only while flagged) and still obeys the signals, the yard and the train
  ahead -- from 45 mph that is ~160 m past you in ~16 s; `back` sets it back
  KINEMATICALLY (no air-brake release lag) at up to `flagBack` 9 m/s,
  1.2 m/s2 in and out, to your live spot, so walking toward the cab ends it
  sooner -- never onto a crossing behind its tail, into another section, or
  within 60 m of the train behind (`_backRoom`; where it cannot, it stands
  and you walk to the beacon); `stand` waits. Flagged at the cab from 45 mph
  you are aboard in ~41 s standing still, ~27 s jogging after it (verify). Standing with its cab
  within 11 m of you, you are put in it (`_flagged`). Walk 40 m off the line,
  get into anything else, keep it standing 90 s (or 7 min in all) and it
  carries on. **The spot is never on a level crossing** (`_flagLead`): if the
  train would stand across one, it stops 25 m short of it or with its tail
  10 m past, whichever puts the cab nearer you. And any train that has stood
  15 s short of a crossing lets its gates up (`standT`; a real circuit times
  out too), so a train waiting there no longer holds them down: they come
  down again the moment it moves. Driving past one in a car changes nothing.
- **Sound** (audio.js): the `gevo` profile (a GEVO-12: firing rate, turbo
  whine with load, rpm follows the notch over seconds), an `AirHorn` voice
  (five bells D#4 F#4 G#4 B4 D#5 through a reed spectrum and a formant, the
  valve's scoop up to pitch and sag down), the rail clack loop (`rail_roll`,
  four axles over a joint per car, at speed / 15 m/s), the crossing and
  locomotive bells, the brake release and the emergency dump. The nearest two
  AI freights get the engine and horn at the lead unit and the wheels where
  the train is nearest you; the horn carries 2 km.

verify's "freight" section: the route, grades, ground never over the
ballast, the crossings and sections, fifteen minutes of service, the drive
from the yard, calling a train, a car held at the gates, a train warning
you, and flagging one down: ENTER beside the lead cab at 45 mph (it stops
within 220 m, sets back and you are driving it within 46 s; sooner if you
jog after it), beside a hopper mid-train
(the hint and the beacon), and at a crossing (it stands short of it, the
gates go up, you climb in at the cab). Cost near the line: +25 draws at Balmer Yard with two trains and the
cuts in view, +220k triangles.

## The Seattle-Bainbridge ferry (v164)

**Two Jumbo Mark II ferries, M/V Wenatchee and M/V Tacoma, sail WSF's
Seattle-Bainbridge run in real time** (`src/ferry.js`): Colman Dock's slip 3 to
Winslow's slip 2, ~34 minutes a crossing (OSM says 35), 15 at each dock.
Drive aboard while one is loading and it takes you across; get out and walk
the decks; or press ARRIVE (the button, or F) and you are docked on the other
side, ready to drive off. On board at the dock, the same button reads SAIL and
leaves now. Waiting at a terminal with no boat in, one is called: the one
that would reach you first is moved up the route to ~2 km out.

- **The route is OSM's** (`tools/extract_ferry.py` -> `raw_ferry.json`,
  `tools/build_ferry.py` -> `data/ferry.json`): way 332476322 into slip 2,
  each slip's axis from its own road's last segment, straight for 350 m out
  of each slip, the corners between rounded by ~600 m tangent arcs (fillets;
  smoothing the samples instead converged to straight lines between the
  pinned straights and kinked at each), tightest bend 460 m. The path is the
  BOAT'S CENTRE: half a hull out of each slip. Mid-Sound each boat keeps 60 m
  to its own starboard, so the two pass port to port 120 m apart.
- **The vessel, to WSF's vessel data**: 140.3 m, 27.4 m beam, 5.26 m draft,
  18 knots, double-ended -- it never turns: the Seattle end (local -z) leads
  out of Winslow. Car deck 3.6 m over the water, passenger deck 9.0, sun
  deck 12.3 (est., from photographs against the beam). Lofted hull with the
  WSF bands, car deck with lanes, the engine casing and an enclosure of
  openings, a cabin of booths behind see-through glass, the promenade, the sun
  deck with rafts and benches, a pilothouse on a crew block at each end, twin
  stacks; lettering on one canvas. 3 draws a boat (body, glass, lettering),
  drawn within 7 km; each slip's towers, wingwalls and OSM dolphins 1 draw,
  within 2.5 km.
- **A boat is its own frame, and its decks are a moving surface.** `SURF`
  is the decks as rectangles in that frame (stairs slope along z), answered
  to `city.groundAt` through `city.movers` by the nearest-surface rule every
  deck follows. Each frame BEFORE the player moves, `update` sails the boats
  and carries whatever stood on one (you, your car, a car left on the deck,
  the chase camera's position): world -> local with last frame's pose, local ->
  world with this one's. AFTER, `constrain` keeps a car on the car lanes (an
  end opens only while docked there) and a walker on a deck at its level, out
  of `WALLS`; and after main.js applies the camera, `clampCamera` keeps it
  under the passenger deck and inside the cabin. (Clamped before
  `applyCamera`, it was simply overwritten.)
- **The terminals were broken, and are fixed before the city**
  (`fixTerminals`, in md.roads, like `stackBores` for SR-99):
  - *Colman Dock is raised to its deck.* The water mask has the dock as land
    (the coastline takes it in), the DEM has it at 0-0.5 m, and its roads were
    imported as bridges at 9.5 m: a 7 m cliff at the terminal building. The
    dock's footprint (a box, wet or dry: its south apron stands over water)
    is raised to 4.2 m through `geo.setFill` -- the carve's mirror: only
    raises, `terrainRaw` includes it, and `fillCell` makes world.js
    re-tessellate its cells, so the dock's edge is a face and not a 40 m
    slope -- and every road wholly on it loses its bridge and tunnel flags.
    That includes the road through the terminal building
    (`tunnel=building_passage`), whose portal cutting dug the dock 5 m down.
    **Only the dock's**: a first version cleared every tunnel within 260 m of
    the slip, which took in four pieces of SR-99's bore under Alaskan Way
    (jank's freeway sites moved; that is how it showed).
  - *The trestles come down to the boat.* Every node on an elevated road
    within reach of a slip is re-seated on a smoothstep ramp by distance: the
    car deck's height at the slip's end, rising to the nearest real land
    (ground over 3 m). Winslow's terminal is a network of piers the importer
    had anywhere from 1.6 to 12.1 m. Those edges are LOCKED
    (citygen `LOCK_NODES`, from `md.ferryFix.lock`): graded, the free dead
    end rose 0.3-0.7 m above the deck.
- The old Colman Dock landmark carried a box model of a ferry; it is gone.
- **Sound** (audio.js): a ship's horn built from `AirHorn` with `SHIP_HORN`
  (G2, D3 and G3 reeds, low formants) -- one prolonged blast leaving each
  slip, heard ~6 km -- and `ferry_rumble` in the bank (the diesels' throb and
  the wash), loudest aboard. `audiorender.mjs --only scene-ferry`.
- The maps draw the route dashed and each boat on it; each terminal is a place
  with a hello.

verify's "the ferry": the slips meet the car deck (within 0.1 m, no step over
0.3 m), no hull point over land anywhere on the route either way or docked
(16k samples), the boats pass 120 m apart, a crossing takes 30-38 minutes, a
car driven on at Colman Dock rides 60 s of sailing without sliding, ARRIVE
docks it at Winslow and it drives off onto land, a walker at sea climbs from
the car deck to the sun deck, and a boat is called to a terminal with none.

### The ferry, polished (v166)

- **The passenger deck has holes where its stairs are.** It was one rectangle
  over the whole hull, so a walker climbing a car-deck stair met the passenger
  deck's surface overhead inside `DECK_REACH` and was lifted onto it -- a 2 m
  hop up the stairwell -- and could stand on the floor over the next stair's
  well. `SURF`'s PAX deck is now pieces with each stairwell left out; the sun
  deck's stairs are outside the cabin (`SUN_Z` 46.3), one at each end on
  opposite sides. verify's walk (car deck -> passenger deck -> through the
  cabin -> sun deck and down) fails on any per-frame height jump over 0.25 m:
  2.07 m before, 0.03 now.
- **Walls are walls**: the cabin's side walls run the hull's breadth with a
  window band, its end walls are solid except two doorways (`DOORS`), the crew
  blocks, stacks and the sun deck's glazed windbreaks are in `WALLS`; the car constraint and the walker's deck
  test keep inside the hull's breadth at their z (the old rectangle let both
  stand over the flare at the ends). The camera stays out of the cabin from
  the promenade, and the on-foot boom aboard is 3.3 m (`camShort`).
- **ARRIVE carries everything on the boat**: `skip()` snapshots you, your car
  and every traffic car on that boat in its frame, moves the boat, and puts
  each back. It used to move only the player: on foot at sea you arrived and
  the car was left mid-Sound.
- **The button is a pill on the right edge** (`_button`, in `#hud`), not in
  `#topBtns`, where it ran into the objective text.

## Link light rail (v146)

**The 1 Line runs across the whole map, both tracks, and you can drive it**
(`src/link.js`): from the map's north edge down the Lynnwood extension,
over the Northgate guideway, through 13 km of bore (Roosevelt, U District,
UW under the Montlake Cut, Capitol Hill, and the downtown transit tunnel's
Westlake, Symphony and Pioneer Square), out at International District, down
the SODO busway, into Beacon Hill, over Mount Baker, down the middle of MLK
Jr Way (Columbia City, Othello, Rainier Beach) and up onto the guideway to
the south edge. Seventeen stations (Shoreline South/148th since v167); 28 four-car trains in service.

- **The route is OSM's.** `tools/extract_rail.py` (one ~75 s scan) writes
  every rail way and stop in the box to `tools/data/raw_rail.json` (the
  freight line is in there too); `tools/build_link.py` builds each track as
  a graph of WAYS joined at their end nodes -- joined at nodes, switches weld
  the two tracks into one network -- walks it north end to south end, crops
  it to the map and names the western track `sb`, the eastern `nb` (trains
  keep right). s runs north -> south on both; sb trains go +s, nb -s.
- **The profile is solved, not imported** (`LinkTrack.setHeights`): at grade
  the smoothed ground + 0.62 m (the bed stands clear of the road surface
  beside it, as MLK's raised trackway does; 0.36 at a level crossing), the
  guideway 8.5 m up, a bore 7.8 m under the lowest ground within 30 m.
  Stations are level, and a station's two tracks share ONE level (the lower
  for a bore, the higher for a deck) so an island's two halves meet. The
  highest profile under every ceiling and the lowest over every floor are
  Lipschitz envelopes at the 5.5 % ruling grade, and **where they cross, the
  grade wins**: a bore that cannot get under the ground in time runs higher,
  and its box stands out of the ground -- that is a portal's covered
  approach, drawn as one, with a headwall.
- **Every metre has a kind** (`KD`): bore, box, guideway, fill, level
  crossing. A bore that starts in the air (the 40 m ground cannot see the
  hillside Beacon Hill's west portal is in) is guideway until it meets the
  ground. A "tunnel" under 400 m is the track passing under something at
  its own level (the ramps south of International District), not a bore. A
  platform partly in the open is an open station: OSM ends the downtown
  tunnel halfway along International District's nb platform.
- **The profile is computed twice**: from the map alone before the city
  exists, because citygen's clear zones (the monorail's mechanism,
  `md.linkClear`) must know where a box stands above the ground -- houses on
  Beacon Hill's east slope stood over it -- and again over the carved
  terrain with the crossings once the city is built. Trees, furniture and
  parked cars keep off the open line through `city.extraClear`.
- **A level crossing is a road that CROSSES the track**: one that also
  covers the track 11 m either way along is a street it runs in or beside.
  Found first, so the rail comes down to the road there.
- **Chunked by 500 m**: per chunk a textured bed (ballast and sleepers), the
  structure (`world.mats.flat`), near detail (rails, poles, wires), the
  boards, mouth cards and the bores. Bores and underground halls are drawn
  (unlit, the glow material, lamp pools every 18 m) ONLY while you drive a
  train whose cab is in one (`tunnelMode`), and mouth cards hide them from
  outside. Guideway columns stand off the carriageways (slid up to 15 m,
  else the span is longer) and are solid.
- **Trains** (`buildLRVGeometry`): a low-floor three-section LRV, 28.9 m,
  a cab at each end, white over a navy skirt with a teal line, a dark window
  band, four double doors a side, seats, poles and lit ceilings behind
  see-through glass, three bogies, a pantograph over the short centre
  section; four cars on one skinned mesh with twelve bones, 2 draws a train,
  the geometry shared by every train (~18k triangles).
- **Service**: 14 trains a track, 20 s at every platform, braking to each
  stop mark, to 55 mph and to 35 in the street, curves at 1 m/s2 unbalanced.
  Moving block: a train keeps 30 m of braking distance behind the tail of
  the one ahead (yours included). At the map's edge a train leaves (the rest
  of the line is off the map), turns back out of sight and comes in on the
  other track. Standing at a station's entrance, the train at the platform
  waits for you (up to two minutes) and the service away from you runs 6x
  until one comes.
- **Getting on** (v148): ENTER at a station's street entrance (on the map,
  a green light-rail icon) or, at a station in the open, anywhere on or
  beside its platforms, boards the stopped train you are beside (or the one
  with the longest left to wait). With none in, ENTER calls one (`call`):
  the nearest train coming toward the station is moved up the line to 180 m
  short of the platform if the track there is clear (the wait skipped), and
  you board it by yourself when its doors open (`pending`, in `update`).
  Only the entrance boarded before, and it had no prompt: standing beside a
  train on the platform, ENTER did nothing.
- **Driving**: POWER and BRAKE, the readout gives the next stop,
  the limit and the train ahead. Stopping within 1 m of the mark pays $60
  (3 m $30); the doors open, and ENTER then puts you out at the street
  entrance. At the map's edge POWER changes ends onto the other track. The
  horn is the bell. In a bore the camera goes into the cab (`camRig`, the
  hook at the top of `player.updateCamera`).
- **At grade the track is not a force field** (`_guard`): on foot or in a
  car on the track, an oncoming train rings its bell and brakes for you,
  planned at the service rate and the emergency brake the moment it is
  late; one that reaches you shoves you off and hurts. AI cars stop for a
  train on (or about to be on) a crossing ahead (`link.blocks`, from
  traffic's obstacle scan).
- `spec.rail` is what "a train" means to the rest of the game (the monorail
  has it too): no building collision, `v.sys.exitSpot` / `onBoard` /
  `onLeave`, no races, the truck horn class.

verify's "Link light rail" section: sixteen stations; the grade within 5.5 %,
nothing at grade under the ground, no bore out of it, no building over the
open line, no column on a carriageway, the entrances dry and off the road;
ten minutes of service (stops made, nothing over 55 mph, trains never closer
than the moving block); a run driven Westlake -> Symphony stopped on the mark
and out at the street; a train stopping short of you on the track; a car
held at a crossing. Cost near the line: +10-22 draws (trains 2 each, a few
chunk meshes); tunnel geometry only in the tunnel. `docs/link/` has shots.
The freight main line is freight.js (v160).

### The 2 Line (v161)

**The 2 Line runs across I-90 to Bellevue**: from Lynnwood (the map's north
edge) on the 1 Line's rails through downtown to the junction just south of
International District, then its own branch east -- Judkins Park, the
Mount Baker tunnel, the I-90 floating bridge, Mercer Island, the East
Channel, South Bellevue, East Main, Bellevue Downtown, Wilburton and Spring
District, BelRed, and (since v167) Overlake Village and Redmond Technology,
off the map's east edge.

- **Four tracks, two of them half shared.** `build_link.py` walks each
  track component north -> south (the 1 Line, unchanged byte for byte) AND
  north -> east: `sb2` / `nb2` are the whole 2 Line route, the same points
  as `sb` / `nb` as far as the junction. link.js finds where they part
  (`share = { track, end }`, the first sample 0.3 m off the parent) and
  copies the parent's profile over that stretch (`_joinShared`, eased back
  over 250 m past it). The shared rails and stations are drawn once, by the
  1 Line's tracks; a station knows every track that serves it (`st.s[k]`,
  `st.lines`).
- **Trains on shared rails see each other.** `aheadOf(t)` counts a train on
  the other line while any of it is on the rails they share (moving block
  across both lines), and `step` collides trains that overlap there
  (`sharedOverlap`). Northbound, the two lines MERGE: a train takes the
  junction (`mergeFree`, one at a time, lapsing once its holder is clear)
  or stops at a signal 25 m short of it; the readout shows JUNCTION SIGNAL
  STOP. Six trains a direction on the 2 Line; they turn back off the map at
  both ends like the 1 Line's, and come back only onto clear rails.
- **On I-90 the rails are the centre roadway**, level with the traffic:
  over the lake a 2 Line bridge rides the road decks beside it (sampled at
  `attach`, `P.bridgeFloor`), else just over the water (`floatDeck` 3.2 m)
  on a concrete pontoon instead of columns. The 1 Line keeps LINK's numbers,
  so its profile is exactly what it was.
- The map draws the branch in 2 Line blue, and its own stations with a blue
  icon; the readout and toasts say which line and where to.

verify's "Link: the 2 Line": its ten stations; grade, nothing at grade
under the ground, bores buried, the floating bridge clear of the lake; ten
minutes of service (its own stations served, never overlapping a 1 Line
train); a merge forced at the junction (one holds, both get through, never
together); a run driven Mercer Island -> South Bellevue, stopped on the
mark.

## The Queen Anne Counterbalance: Route 26

**Streetcars run Route 26, "West Queen Anne", and you can drive one up the
counterbalance** (`src/counterbalance.js`). From 1901 to 11 August 1940
Queen Anne Avenue N between Roy St and Lee St was too steep for a streetcar
on its own: 13.8-18.7 % [EN], "up to 19 percent" [K]. So every car was
hooked to a 16-ton counterweight that ran in a tunnel under the street. A car
going up was pulled by the weight coming down, and a car going down hauled it
back up. The tunnels, and reportedly both weights, are still under the
street [K][QA2][W]. The hill is still called the Counterbalance. Frasier said
he lived on it.

**Sources.** Each figure in the header of counterbalance.js names one of these:
- [EN] *Engineering News*, 9 Mar 1911, "A Cable Counterweight System for a Steep Grade on an Electric Railway at Seattle" (archive.org `sim_enr_1911-03-09_65_10`). It gives the mechanism, the 2,600 ft system, the grades, the 13.7 % tunnels, the 16 t weights, the 12 min headway per track and five stops each way.
- [K] HistoryLink 20746 (Kershner).
- [D] HistoryLink 3027 (Dorpat): about 8 mph, cars 311-320.
- [F] HistoryLink 20980: the last run, and the dogleg at Galer.
- [QA1] [QA2] Queen Anne Historical Society: "Counterbalance & Streetcars", "Men in Little Boxes".
- [PNR] Pacific Northwest Railroad Archive: car 315 at 6th Ave W & McGraw, and the Lee St photograph, July 1940.
- [T] The Seattle Municipal Street Railway route list of 1 Apr 1931, as transcribed at tundria.com.
- [W] Wikipedia, "Queen Anne Counterbalance".

**How it worked** [EN]. Each of the two tracks had its own endless cable over
two 10 ft sheaves. The cable's upper run lay in a slotted conduit between the
rails, and its lower run pulled the weight: cast-iron slabs on two coupled
trucks, on a 30 in track in a 5 x 4 ft tunnel at a uniform 13.7 %. At each end
of the hill a car stopped, and the conductor dropped a forked "finger" on its
truck into a notched steel "plow" clamped to the cable. Attendants in little
boxes on the kerb at Roy and at Lee hooked cars on and off [K][QA2]. A track's
weight could only serve a car at the end where the weight was waiting. So
uphill cars took whichever track's weight was at the top, and the crossovers
at Lee in the 1940 photographs are where they changed sides [PNR][QA2].

**Where the cable ended: the sources disagree, and the game uses Lee.**
- *Comstock St:* HistoryLink [K] calls it "five steep blocks between Roy
  Street and Comstock Street", and Wikipedia's ~1,500 ft runs Roy-Comstock.
  The Queen Anne Historical Society gives Mercer-Comstock. That is where the
  steep street ends.
- *Lee St:* PNR's July 1940 photograph (WWASMR-26-011) is captioned "Queen
  Anne Avenue at Lee Street ... counterbalance cable pick-up". [QA2] has
  uphill cars switching back at Lee, and the 1937 "2,150 foot hill" fits
  Roy-Lee (Roy-Comstock is ~1,820 ft).

The steep blocks stop at Comstock and the cable's pick-up was a block on,
at Lee, which is why the game hooks on and off there.
The weight is 16 t [EN]; HistoryLink describes it after about 1907 as two
8 t cars, for the heavier double-truck streetcars. That is the same total,
so the physics uses 16 t.

### The route

The route is best attested in 1931 [T][PNR][F]. It ran north on 1st Ave from
Pioneer Square, onto Queen Anne Ave N at Denny Way, up the counterbalance from
Roy St to Lee St, west on W Galer St (the dogleg), and north on 6th Ave W to
W McGraw St, where a wye turned the cars.

Stops, northbound:
1. Pioneer Square (1st Ave & Cherry St)
2. Madison St
3. Pike Place Market
4. Bell St
5. Denny Way
6. Mercer St
7. **Roy St** (hook on)
8. Aloha St
9. Highland Dr, for Kerry Park
10. **Lee St** (unhook)
11. 3rd Ave W
12. Blaine St
13. McGraw St

The line is 5.4 km each way. The counterbalance, mark to mark, is 598 m and
rises 69.5 m. It is steepest at 18.6 %, against a published 18.7 %. Three
changes for today's streets:
- **The line ends at 1st Ave & Cherry St.** In 1931 it ran three blocks on, to
  S King St, but south of Cherry today's 1st Ave S is a divided road.
- **Northbound cars run up 1st Ave N and along Roy St.** Lower Queen Anne Ave N
  is one-way southbound now, so only the southbound cars use it.
- **Both ends are stubs.** The double-ended cars change ends there, where the
  real ones used a wye at McGraw.

Other 1931 lines also reached the top of the hill without the counterbalance
(24, 25 East Queen Anne, 7 Kinnear Park). They are not built.

### How it is built

- **The route is laid on the road graph at boot, from way points.** `LEGS`
  lists the intersections and the street each leg runs on. `routeNodes`
  runs Dijkstra over citygen's edges: other streets cost 25x, and one-way
  streets can only be taken their own way. **OSM can split one street by a
  metre where two ways meet without sharing a node** (1st Ave N at Thomas St),
  so a leg's own street's nodes within 3 m are joined. Without that the whole
  line failed to route. Each direction is its own track (`out` runs north,
  `in` runs back). Corners are rounded (up to 20 m), and each track lies 1.7 m
  right of the centreline. **On a curve the tracks are laid up to 2 m wider
  apart**: a 13.4 m car's ends swing ~1 m out on a 20 m curve, and two cars
  meeting at the Galer / 6th Ave W corner locked together until they were.
- **The rails follow `city.groundAt`**, seeded from the sample before and
  lightly smoothed (never below the road). The probe holds the rail head 0 to
  0.11 m over the drawn road. Each track also keeps the heights `2 x lat` to
  its left (`YL`), where a car on the other hill track runs.
- **The hill: two tracks, two weights, not one-way.** The `E` weight is under
  the out track's rails and the `W` weight under the in track's.
  `free(P, car)` asks whether weight P is at this car's end (top for a car
  going up), whether nobody holds it, and whether nobody is on that physical
  track's hill. An AI car takes its own side if it can, else the other. With
  neither free it waits at a signal short of the crossover; the probe's
  longest wait in 20 min of service was 45 s. A car on the other side is
  shifted `2 x lat` to its left through the crossovers below Roy and above Lee
  (`shiftAt`, `railPoint`), and those crossovers are drawn. **While a car is
  hooked on, its weight's position is its own mirrored** (`f = 1 - up`).
  Nobody can lose a weight, because the plow cannot pass a sheave: run off the
  end hooked and you are stopped there and unhooked. A weight stranded at the
  wrong end (you left a car on the hill) is wound back by the attendants
  (`winch`) after 20-45 s of waiting.
- **The physics is what made the counterbalance necessary.** The car is
  20 t, its motor 1.3 m/s2 at low speed, and adhesion 0.16 (sanded). So a car
  alone climbs ~12 % and holds ~17 % on the brake, which is enough for 1st Ave
  but not for the hill. Unhooked on the counterbalance, POWER spins the wheels
  and the car goes nowhere, and the brakes slide it back down the steepest
  block. Hooked on, the weight adds 16 t x g x 13.7 % toward the top. That is
  the tunnel's uniform grade, not the street's, so the hill feels different
  block by block. A small governor holds a hooked car under ~11 mph. An AI car
  you abandon on the hill unhooked is hooked back on (`_ghost`), or it would
  slide down forever. The 1919 runaway [K] is a toast.
- **The cars** (`buildCarGeometry`) are modelled on car 315 in July 1940
  [PNR]:
  - double-truck, enclosed and double-ended;
  - a railroad clerestory roof;
  - ten windows a side with guard bars;
  - folding doors, a dash headlight, a "WEST QUEEN ANNE 26" dash sign, the
    "26" route box and the destination glass;
  - an ad card on the dash (the photograph's sale at the Bon Marche);
  - the car's number on each side.

  Lettering is a 3 x 5 pixel font in vertex colours. **The livery is
  unsourced.** The photographs are black and white (light body, dark roof and
  trucks), so the cream and dark green is a period guess, and the guide says
  so. Both ends are the same model turned 180 degrees, so changing ends only
  turns the car. The raised pole is always at the back, and it reaches the
  wire at 5.5 m. Each car is two draws: body, plus trim (glass, brass and
  nickel through the vehicles' glass shader). Beyond 110 m (70 m on a phone)
  the trim is hidden, so a car further off is one draw. 3,370 triangles.
- **The line's geometry** is one vertex-coloured mesh per 1200 m cell. The
  grid is shifted (`CX0`, `CZ0`) so the whole counterbalance is one cell, and
  each cell is drawn within 560 m (360 m on a phone). A cell holds:
  - the rails, each with a groove, set in a concrete band;
  - the slot and its Z-bars, and a plate every 22 m, on the counterbalance;
  - the crossovers;
  - kerbside poles with bracket arms, and the trolley wire;
  - a white-banded "CAR STOP" post at every stop;
  - the attendants' green boxes at Roy and Lee;
  - two plaques with pixel lettering.

  The material has a polygon offset, so ground-hugging strips win against
  the road. Trees, furniture and parked cars keep off the rails
  (`keepClear` through `city.extraClear`).

### Driving it, riding it, traffic

- **Board** like Link: on foot, ENTER beside a car that is stopped or rolling
  under 2.6 m/s (`boardable`). At a stop with no car in, ENTER calls the next
  one: it is moved up to ~150 m out, if that would not skip the hill or
  overrun another car, and it waits for you.
- **Drive.** You are the motorman: POWER, BRAKE, and BELL on the horn button
  (main.js relabels it, and back to HORN in anything else). Holding BRAKE at
  a stand reverses. At a stub end, POWER at a stand changes ends.
  - Stopping on a stop's mark pays $15 within 1 m, $8 within 3 m.
  - At Roy (going up) or Lee (going down), stop on the mark and stand: the
    attendant hooks you on (the clunk, and a toast the first time). Unhook the
    same way at the far end.
  - The readout fits a phone's top pill, in the speedometer's km/h (e.g.
    `312 · 9/13 km/h · hook on at Roy: 2.8 m`). It shows the next stop, the
    approach to the hook, the weight's place in its tunnel while you are on
    the cable, and why you are going nowhere when unhooked on the hill.
    Toasts stay under ~60 characters, and repeated ones are rate-limited
    (`sayOnce`).
  - **At a stand the brake holds by itself** until you touch POWER, so a car
    you board on the 11 % at Roy does not roll. Since the brake holds by
    itself, **BRAKE held for 1.2 s means "back up", on any grade**, with the
    full motor. You must always be able to get out of the way: at Lee's -4 %
    the old 0.35 m/s2 reverse could not back a car up hill at all. A crew's
    car right behind you backs out of your way when you do. (Before the
    auto-hold, a held BRAKE at the Roy mark engaged reverse after 0.6 s and
    slid the car off the mark.)
  - **The hook window and the sheave are the same `CB.hookTol` (1 m).** The
    window was 3 m and the sheave 1.2 m, so a car hooked 2 m short was jumped
    to the mark and unhooked in the same breath. A car never re-hooks where a
    sheave has just let it go until it has moved 3 m.
  - **The stop block: nobody goes down the counterbalance without a weight.**
    An unhooked car on the descending track is held 0.75 m past the Lee
    mark, inside the 1 m hook window.
    Driving down unhooked with no weight at the bottom used to run away into
    the climbing car.
- **THE SIGNAL: you wait at the gate like the crew.** Short of each
  crossover is a gate (`tr.gate`, moved back off any curve: the out track
  turns off Roy St right there, and a car waiting on the corner fouled the
  other track). Your car is given a cable on the way to it, if one is free.
  If none is, the signal holds you at the gate, and the toast says why:
  "no weight at the top yet", "the cable is in use", or "a car is coming to
  this mark on the cable — back up". A checker found the jam this prevents.
  A player's car went down to the Lee mark with no cable while a crew's car
  climbed to it hooked on the same cable. Each waited for the other, and the
  player could not back up the -4 %.
- **Cars see each other by where they are, not by track** (`sameRails`). On
  the hill a car of the other direction can stand on your rails, because it
  took the other cable. The car-ahead rule and the collision in `step` used
  to compare `o.track === tr`, so a car on the other track's key was
  invisible there. A checker reproduced it: a player's runaway met the
  climbing car, he bailed out, and both cars stood nose to nose for good.
  Every descending car queued behind them, and the line was dead until a
  reload. Now:
  - **Nose to nose, one gives way** (`yields`): the car on the cable keeps the
    hill, then the car on its own rails, then you, then the older car.
  - The car that yields **backs off** at 3 m/s (`_backOff`, kinematic: the
    crew), to its own rails short of the crossover.
  - **Nose to nose is checked in a dwell too.** A car dwelling at a mark used
    to wait for ever.
  - **A crew's car on the hill with no cable of its own** (you left it
    there) takes a free one if it can. Otherwise it backs off to the gate,
    and a car of the crew behind it backs off further, so two cars that
    cannot pass clear the hill in order. A car past the gate with no cable
    backs to the gate too, and a car waiting there counts toward the
    attendants' winch.
  - **"In the way" is asked from both cars' sides** (`inWay`). A car
    crossing over is off one car's path while its body is still across the
    other's.
  - **The bodies decide the rules**:
    - A car going the same way is in the way if its body reaches yours
      (2.84 m).
    - One coming the other way is in the way only on your very rails
      (1.4 m), except at the stub ends, where the two tracks are one.
  - **A car changing sides has the hill to itself** (`free`). Cars on their
    own cables share the hill: going opposite ways on their own rails they
    never meet, and going the same way they queue. A car on the other cable,
    though, crosses everybody's rails twice, in the scissors crossovers below
    Roy and above Lee, and every rule that tried to share the hill with it
    left a jam for the fuzz probe to find. The scissors also have a lock of
    their own (`takeX`, `sys.xlock`), now a second line of defence.
  - **A cable given on the way to the gate is kept** until the car is 100 m
    back from it. It used to be let go 10 m short of the crossover, so your
    car was given its cable and lost it every frame at the gate.
  - **A cable goes to the front of the queue** (`queuedBehind`). Two cars
    behind a cable-less front car once held both cables while the front car
    waited for ever. For the same reason, a car of the same track behind the
    one asking, not hooked on, does not stand in its way, even if that car
    was given the cable first.
  - **The winch winds only the waiting car's own weight** (`winch(need,
    car)`), never one another car holds or has been given. Two cars waiting
    at opposite ends once wound one weight back and forth at each other
    every 45 s. A car standing anywhere on the approach or the hill for want
    of a cable counts toward it. A car waiting at its gate is waiting, not
    stuck, and is never towed.
  - **A stranded car past the mark goes on** with the crew's help
    (`_ghost`). Backing it off ran it into whoever followed it up or down.
  - **Everyone waits at the gate**, for a cable or for the scissors. The
    stretch between the gate and the crossover is the Roy corner, where a
    standing car fouls the other track. A car found past the gate with
    nothing to go on backs to it.
  - **A body test before any move** (`boxPen`). In service, and backing
    off, a car does not make a move that brings its body closer to another
    car's, whatever the rails say: yours parked across a corner, one
    swinging through a crossover. It looks as far ahead as the car needs to
    stop. Two cars blocked this way for 8 s settle it as nose to nose does.
  - **At the end of the line with no stop ahead** (you stopped on the
    terminus and got off rolling) a car changes ends anyway.
  - **A car standing in service for two minutes is towed** (`tow`), but
    only when both it and the spot it is towed to are out of sight: farther
    than a car is drawn from you and from the camera. If the cause is
    another of the crew's cars standing in its way, that car is towed
    instead. The rules above should never leave a car stuck; this is the
    floor under them.
  - `cbprobe --only robust` covers it:
    - two cars nose to nose on the W rails;
    - a car abandoned unhooked mid-hill;
    - POWER downhill at Lee with no weight;
    - BRAKE at the Roy mark;
    - hooking on 0.8 m short;
    - ENTER at a stop's post;
    - eight minutes of service afterwards, in which every car must make stops.
  - **`cbprobe --only fuzz`** stops finding jams one at a time:
    - Each of `CB_FUZZ_SEEDS` seeds (default 40; `CB_FUZZ_FROM`) puts every
      car in a random state: each mark in both directions, each crossover,
      mid-hill hooked or not, each stop, each stub end, cables assigned
      (sometimes illegally), the weights anywhere.
    - You are either away; or you board a car, press random POWER / BRAKE /
      reverse and leave it, standing beside it; or you stay aboard.
    - It then runs `CB_FUZZ_MIN` (15) simulated minutes.
    - The invariants: no two bodies ever overlap; with you out of it, every
      crew car makes a stop or a hill trip; staying aboard, you can always
      move your car one way or the other.
    - Each failure prints where every car stood longest and what it stood
      for. It found the corner gate, the scissors, the merge, the terminus,
      the one-sided "in the way" test, the boxed-in reverse, the exclusive
      hill, the winch war, the backward roll and a player standing on the
      rails.
- **Board from the stop post.** The post stands on the kerb, 7-11 m from the
  rails, so ENTER there also boards the car standing at that stop.
- **People crossing at a corner** (peds.js, traffic's `crossXZ`) stop a car
  in service, as they stop traffic. **You, standing on the rails**, get 8 s
  of ringing; then the car edges on at a walk and nudges you aside. A car
  that waits for ever for someone who never moves is a jam too.
- **Ride.** The RIDE pill (or V) hands the car to its crew, and DRIVE takes it
  back. While riding you are drawn out on the front entrance's step, upright
  whatever the grade, as on a cable car's running board. On the counterbalance the riding camera (`camRig`) moves to the
  downhill platform and looks down Queen Anne Ave at the city. It yields for 3
  s whenever you drag the view.
- **Getting off** is allowed anywhere under 4.2 m/s, onto the street on the
  door side. Every way out must leave nothing behind: the door, WASTED and its
  respawn, a warp, the pause menu's respawn. `update` notices a car whose
  driver is no longer in it and runs `onLeave`, which puts the car back in
  service and clears the readout and the button. The probe checks the door,
  WASTED and the warp.
- **Traffic.** traffic.js asks `streetcars.blocks` along its path, the way it
  asks Link's: an AI car queues behind a streetcar at its stop, and waits
  for one crossing. A car in service brakes and rings for you, your car, or
  AI traffic on its rails ahead (`_guard`). The exception is a traffic car
  standing nose to nose with it: that car is waiting for the streetcar, and
  if the streetcar waited too, neither would ever move. Anything inside a
  car's box is pushed out the short way, and you get hurt if it is moving.
- **Sound** (audio.js; the wheels' and the cable's loops on the world bus, so
  they go quiet behind the pause):
  - `cable_bell`: one hard strike of a bronze gong. A held BELL repeats it
    into the cable-car rhythm, and AI cars ring twice leaving a stop and
    three times at anything in the way.
  - `cb_clunk`: the finger dropping into the plow.
  - `cb_hum`: the cable in its conduit, under a hooked car.
  - The nearest car's wheels are the `rail_roll` loop. Its motor is the
    `traction` engine voice (main.js `withTrains`).
- **Maps.** Both tracks are drawn in maroon, bolder on the counterbalance,
  with the cars as cream dots. Each stop has a streetcar icon; the termini and
  the two hitch stops are labelled.

`node tools/cbprobe.mjs [--phone] [--only ...]` checks the line, twenty
minutes of service, the drive up the hill, the unhooked slip, riding, an AI
car behind a car at its stop, the exits, the draws, and the shots.
Measured on the desktop profile:

| Where | Extra draws | Extra triangles | What is drawn |
|---|---|---|---|
| From the spawn (330 m from 1st Ave N) | +2 | +21k | two cells |
| The foot of the hill, a car in view | +4 | +39k | two cells, a car's body and trim |
| 1st Ave at Pike, a car at its stop | +4 | +25k | |

Away from Queen Anne and 1st Ave the line costs nothing: no cell and no car
is in range. LOOK at the shots in `tools/data/cbshots/`.
