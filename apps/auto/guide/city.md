# Auto: Buildings, landmarks, parks and lots

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Buildings: variety

**Every house in the city was one off-white under one slate roof**
(`tint(seed, [0.94, 0.92, 0.88])`, one gable form), so from a street or a plane
a neighbourhood was the same texture repeated. v110:

- **Paint and roofing are weighted palettes** (`HOUSE_PAINT`, `HOUSE_ROOF` in
  world.js): whites, creams and greys, sage, olive, slate blue, navy,
  charcoal, barn red, mustard, teal, brown shingle; asphalt greys, brown,
  black, slate, moss, terracotta, metal. **Houses go through `paintTint`, not
  `tint`**: tint's 38 % pull toward grey is right for masonry and turned every
  paint back into the off-white it replaced.
- **Three roof forms**: gable (pitch 0.46-0.82), hip (`meshHip`, 4 slopes, a
  pyramid on a square footprint) on squarer footprints, and a flat modern box
  with a coping on ~11 %. A fascia board under the eaves in a trim colour
  (mostly white).
- **Front porches** on ~40 % of houses wider than 6.5 m: deck, two posts,
  roof, on the step's side, skipped wherever `onRoad` finds the street there.
- **Five more wall families** for everything else (beige stucco, dark brown
  brick, grey-blue, salmon and ochre paint), and **flat roof lids** are a
  palette too: grey membrane, white single-ply (more of it on big roofs), tar,
  gravel, the odd green roof.

All vertex colour on the existing materials: no draws, no textures. Wallingford
9x9 ring: 2.89 M -> 3.11 M vertices (+7.6 %), chunk builds +5 %, longest step
1.3 -> 1.4 ms; perfguard downtown +0.7 % triangles. `landmarkshots.mjs` has
`hood-*` street and aerial views of eight neighbourhoods for judging it.

## Houses: dormers, garages, and modern townhomes (v156)

Each on a share of the houses by the house's seed, all vertex-coloured boxes
in the chunk's `flat` builder (no draws, no materials):

- `houseExtras`: dormers on a steep gable's front slope (a third of those
  with room: box, framed window, their own little gable), a chimney on hip
  roofs too, solar panels on the slope facing most to the south (one in
  eleven), an attached garage with its door and a drive (one in eight,
  where the lot beside is clear of road, water and buildings), a bay window
  on the front where there is no porch (one in six), a railing on porches.
- `townhome`: the flat-roofed form (11 % of squarer houses, and 30 % of
  footprints longer than 2.6:1 -- one long footprint is how OSM draws most
  terraces) is a modern townhome or a row of them: `MODERN_PAINT` (charcoal,
  white, grey, near-black), panel cladding (the concrete cell at 10 m, not
  clapboard), ~7 m units along the long side each with a cedar accent panel
  (most), glazing on every floor, a recessed door under a canopy, a balcony
  with a glass rail on the top floor (and a middle one on some); a parapet,
  and on half a stair penthouse on the roof.

Cost, `rendercpu --builds --ring=4` in Wallingford (dense housing), against
the base: 3.12 M -> 3.48 M vertices (+11.7 %), chunk builds 350 -> 373 ms
total. The first cut was +24 %; the townhomes were ~240k of it (per-floor
balconies, mullions) and the extras ~140k -- attributed by stubbing each
method through `RCPU_PRE` (`w.townhome = () => {}`), which is the way to
find what a building feature costs. `docs/houses2/`.

## Buildings: the outlier scan

`tools/bldshots.mjs --scan` counts every shipped box into categories (style x
height x footprint, slope gap under the lowest corner, over water, overlaps,
aspect, sheds, storey pitch...) and photographs samples of each, seed-sorted so
two checkouts shoot the same buildings; `bldsheet.py --pair` lays before and
after side by side; the before | after sheets of each fixed category are in
`docs/buildings/`.
Looking at them, not at the numbers, is what found most of this:

| category (of 259,083 boxes) | count | what it looked like | now |
|---|---|---|---|
| masonry/glass under ~20 m | 54,729 | four window rows in any wall that short: the 53,075 untagged 6.4 m blocks were four 1.6 m storeys | whole STOREYS snapped (~3.4 m masonry, 3.0 brick, 1.7 m a pane row), each tier's pattern hung from its top |
| every house | 192,330 | siding began at `base`, 2 m underground, one tile stretched over the height: every front door a 1 m brown stub in the lawn, lower windows halved | siding from the centre's ground, tile over the visible wall; concrete foundation below |
| houses over 16 m long | 62,270 | the one elevation stretched round the face, 4-5 m doors | `box({ uFit })`: whole elevations per face, ~11 m each |
| campus (civic) | 808 | the HOUSE cell, one tile a face: 60 m clapboard, 10 m front doors, plus a glass shopfront | civic stone/brick families, no shopfront |
| untagged industrial < 120 m2 | 1,517 | garages and sheds at the 8.5 m warehouse default: corrugated towers in back gardens | 3.2 m (5.5 m under 400 m2), a low gable, no parapet or plant |
| gap under the lowest corner > 1.5 m | 4,237 (13,754 > 30 cm) | walls stopping in mid-air on the downhill side | the lowest wall, shopfront or foundation reaches the lowest corner; a house on a steep slope gets a daylight basement |
| over water | 1,309 | Lake Union's houseboats and pier sheds standing on the lake BED, flooded to the sills | stand 0.6 m over the body's surface (`standY` in citygen) |
| roofs over 1,500 m2 | ~1,000 | one to three plant boxes whatever the area: a blank field | plant on a ~22 m grid (capped 30), skylight rows on industrial |
| industrial walls over 36 m | ~370 | one corrugated tile down a 300 m shed | pilasters every ~24 m, roller doors on one long face |
| glass family under 12 m | ~7 % of low blocks | curtain wall on a one-storey box | concrete instead |

Left alone, on purpose: **overlaps** (79,474 pairs, 40,734 deeper than 3 m)
are overwhelmingly terraces and L-shaped houses whose oriented boxes intersect,
and read as joined roofs; slivers and needles are a few dozen real buildings.

Laws that came out of it:

- **A facade tile is snapped in storeys, not in tiles**, and hung from the top
  of the wall (`vOff = 64 - h / vS`), so the parapet lands on a storey line
  whatever the embed or a slope does to the base.
- **The house tile is one composed elevation** (two floors, door bottom-right):
  it must span the VISIBLE wall. Anything that moves a house's base (slopes,
  water) moves the foundation, not the siding.
- **The blob's heights are guesses for 97 % of footprints.** A guess can be
  refined by size (`untaggedHeight`), a tagged height never is. Changing a
  height changes the boot-cache's `buildings` entry, so it ships with the
  build bump like any other change to the city.
- **Nothing here may add a material.** Foundations, pilasters, doors, gables
  and plant are `flat`; basement siding and skirts are the facade atlas.

Cost, measured against the base served side by side, three runs each: the
downtown 9x9 rebuild (`rendercpu --builds --ring=4`) near chunks 430-528 ms ->
429-478 ms, longest step 12-27 -> 13-28 ms (noise either way); geometry
2,815,966 -> 2,825,532 vertices (+0.34 %); `rendercpu --stream` respawn mean
5.1-7.1 -> 4.9-6.1 ms. perfguard downtown: 131-132 steady draws both,
triangles 1,136,976 -> 1,143,574 (+0.6 %).

**`bldshots` stands on the water where it is wet.** Lake Union's surface is
at 5.3 m over a bed near 0; a camera at terrain + 1.7 was under the lake,
which then is not drawn, and the "before" houseboats looked merely wet
instead of drowned to the eaves.

## Solid street objects

Until recently the **only** solid thing in the entire map was a building: trees
and lamp posts were scenery you drove and walked straight through.
`world.buildChunk` registers trunks and poles into `city.obstacles`, keyed by
chunk so they are cleared with the geometry that drew them, and
`city.obstacleHit(x, z, r)` returns the deepest overlap.

Both collision paths consult it: `collideWithBuildings` tests obstacles *first*
(a tree is nearer than the building line and is what you actually hit coming off
a kerb) with a softer response than a wall, and `Player.blocked` uses a circle so
you slide around a trunk instead of sticking to it. The radius is the **trunk**,
not the canopy -- blocking the full spread makes a park impassable.

**Landmarks are solid too, through the same call.** `city.setLandmarkSolids(list)`
installs them once at boot on a 40 m grid, and `obstacleHit` answers them after
trunks and barriers, so the player's car, traffic and walking all collide with
no call site changed. Each solid is a circle or an oriented box with a height
band `[y0, y1]`: nothing above `y1` is blocked, nor anything more than 2.5 m
below `y0` (the trunks' underground rule). Builders push colliders in their own
frame (`solidCircle`, `solidBox`, `solidOutline` for a wall along every edge of
a plan) and `worldSolid` turns them through the group's yaw. **A box's world rot
is `rot - t`**, because three's `rotation.y = t` maps local (x, z) to
(x cos t + z sin t, -x sin t + z cos t).

- **The Needle is solid at its column feet and core only** (`needleSolids()`:
  a 3.6 x 2.2 m box per foot, a 3.3 m circle for the core), so you can walk
  under it. **The pavilion's glass ring (r 18.4 m) is not solid, on purpose**:
  it encloses the base, and a solid ring makes the core unreachable.
- **Every solid is tested against the roads before it is installed**
  (`city.onRoad(x, z, 0.3, false)` over its footprint; decks ignored, so a
  viaduct overhead drops nothing). Dropped ones are listed in
  `landmarks.userData.solidsDropped` — today a few pieces of the convention
  centre's wall where Convention Place and the Pike Street ramp enter it, two
  of the ferry terminal's where Colman Dock's vehicle lanes pass. **A dropped
  solid usually means the MODEL is on the road too**: Smith Tower's east wall was
  dropped until its lot was clipped clear of the street (`clipHalf`), because
  OSM's lot runs to that street's centreline.
- **A wall is a row of short solids, never one long one** (`outline` in
  `lmdowntown.js`: pieces of ~12 m). The Convention Center's 130 m Pike Street
  face was ONE solid, and one street crossing its end dropped all of it -- a
  car drove through the whole front. **A solid with `surfaceOnly` is dropped
  only by a road on the surface** (`onRoad(..., includeTunnel = false)`): I-5
  runs in a tunnel under the Arch, and a tunnel under a wall is no reason to
  drop it. That also needs the solid's `y0` at the GROUND where the wall
  stands (a function of the piece's midpoint), so a car in the tunnel is more
  than the 2.5 m below `y0` that a solid reaches and is not hit by the wall
  above it.
- **A deck you can walk onto needs a solid that ends 0.3 m under it.** The
  Locks' walls are platforms (`userData.decks`) and solids: with the solid's
  `y1` at the deck's own height, a walker standing on it is *at* `y1` and
  blocked by the wall he stands on; at `deck - 0.3` the walker is above it and
  a boat or swimmer at the water is not. A deck may be sloped: `top` is its
  height at its -v end, `top1` at its +v end (Kerry Park's terrace falls 4 %).

**Greenspace and footprints are separate OSM layers and they overlap.** Park
polygons are mapped straight over the museum, pavilion or house standing in
them, so `inPark()` happily says yes in the middle of a building: 9.3 % of
surviving park-tree candidates stood inside a footprint. Anything scattered on
open ground needs `inBuilding()` as well as `inPark()` and `onRoad()`.

## Landmarks

The rest are built to published dimensions where any exist, and to the OSM
footprint where the plan matters. The table at the top of `landmarks.js` gives
each number and its source; "est." marks one no source publishes, and says what
it was set from. Collision is in "Solid street objects".

- **Plans come from OSM, not from a box.** `tools/data/raw_buildings.json` holds
  every footprint as a projected polygon; MoPOP, the arena's south atrium, the
  Lumen and Husky bowls and T-Mobile's bowl use one directly, simplified to
  ~1.2 m and stored relative to the landmark's point. The Spheres' centres and
  radii were fitted to the lobes of their footprint.
- **A footprint is not always a plan you can build.** The Main Arcade's OSM ways
  run down the bluff and over Western Avenue; built as a prism they stood a
  20 m wall across Western. It is a strip along Pike Place's west kerb now,
  measured with `city.onRoad` stepping out from the centreline. Check any
  footprint-driven model against the roads (`solidsDropped`) before believing it.
- **A landmark's OSM point may not be where its model goes.** The "Pike Place
  Market" node sits 220 m up the bluff from the sign, and a clearing radius
  round it deleted ~75 m of real buildings on the wrong block. The model is
  placed at `g.userData.at` (the Public Market Clock node), and a
  `LANDMARK_CLEAR` entry may be a list of `[dx, dz, r]` circles instead of one
  radius.
- `userData.worldAligned` makes `buildLandmarks` ignore `l.rot`, for plans
  already in world axes (every footprint-driven one). `userData.baseY`
  overrides the terrain height for anything on a pier: the Great Wheel's point
  is 2 m under the bay.
- **Clusters, not one mesh.** Landmarks within ~1.2 km merge by material into a
  cluster that culls on its own bounds, so a view of the stadiums does not pay
  for Seattle Center. `P()` caches palette materials by
  colour/roughness/metalness, and all lettering is one canvas (`SignAtlas`), so
  a cluster is a handful of draws.
- **Smith Tower is a landmark now**, not an ordinary OSM box the size of its
  lot. It is appended LAST to `places.json` (and `build_places.py`), so
  activities.js still gets the same collectibles.
- **MoPOP read as inflatables** until it had near-vertical walls rolling into a
  low crown (not a dome), folds in plan deepening toward the top, and a shingle
  map. Its colour placement is est., from photographs.

- **Bellevue Downtown Park is built from its OSM water** (`bellevueDT`,
  v111): the 10-acre lawn inside the ring canal (r 96.7-101.7 m), the
  promenade under a double row of trees, the reflecting pond and the canal's
  straight arm as mapped, and a stepped waterfall down the pond's east edge.
  Before, `bellevueDT` had no builder, and the import had dug a 20 m DRY
  CRATER there: `build_raster.py` digs a bed under every heightfield cell
  touching water, but only a lake over 20,000 m2 gets a water plane.
  `geo.TERRAIN_FLATS` levels such a spot at load (vertices within r0 set to
  the ground just outside, blended to r1) before anything reads the terrain.
  **Other small ponds have the same pit**; the importer-side fix (no bed
  under unlabelled ponds) needs a raster rebuild and a road re-grade, so it
  is a separate change. `city.clearCircles` keeps the scatter off the lawn.
  1 draw, 17.6k triangles; views `bdp-*` in landmarkshots.

### The downtown landmarks rebuilt from their OSM plans (`src/lmdowntown.js`)

The Convention Center, the Central Library, the Aquarium, Colman Dock's
terminal, Kerry Park and the Ballard Locks were boxes and a tube; they are now
built from the OSM plans, in their own module because they share a kit
(`Acc`, `walls`, `cap`, `skin`, `vault`, `clipPoly`, `insetPoly`) the older
builders do not need. It takes landmarks.js's palette, sign atlas and solids
through `makeDowntown(h)`, so every piece still folds into the same cluster
meshes (the header table gives each number and its source).

- **A hillside building's skirt follows the ground** (`walls(acc, poly, base,
  top, ...)` with `base` a function of x, z: `groundFn`): the Arch's podium is
  ~4 m high on the freeway side and ~20 m on Pike Street, as the hill makes it.
  A box at a fixed `y` either floated on the downhill side or stood in the hill.
- **The Arch stands on the ground; I-5 runs under it** (OSM layer -1/-2, a
  lid), so there is no span to draw. It is the OSM way's plan (66 points, 244 x
  128 m, in a frame turned 0.558 rad to the street grid), a pale precast
  podium, a glazed block set 3 m in, a roof of four skylit barrel vaults on
  steel ribs, a glazed portal on the Pike Street front. **One texture serves
  both walls**: the canvas's top half is a precast storey and its bottom half
  a curtain-wall storey, and `walls()` splits the wall at every 4.5 m of
  absolute height so each band's v stays inside its half (a wall on a slope
  cannot tile a two-storey texture any other way).
- **The Library is five platforms lofted between rings** (`skin`): each
  volume's bottom and top are the OSM plan scaled, sheared and shifted
  differently, so the sides lean and each platform overhangs the one below. The
  skin is one texture, a diamond grid of steel over glass with a lime floor band
  every two floors; the reading room's roof is a tilted plane. It reads
  as the real building from the air and across a street.
- **The Aquarium's entrance is on its SOUTH face**: east of Pier 59 is water (a
  cove between it and the Ocean Pavilion), and the OSM way the importer drew as
  a roofed box along the south is the approach pier, 150 x 22 m. It is a plank
  deck on piles now, walkable (`decks`, the last with a `land` gangway to the
  shore). The Ocean Pavilion is on the land to the north-east, with a
  planted roof over its water end; `LANDMARK_CLEAR.aquarium` clears its OSM box.
- **Colman Dock's terminal is the OSM entry building (16 x 90 m, 0.553 rad)**
  with a glass canopy toward the slips and an overhead walkway built in WORLD
  axes (`toL`) so it runs due west whatever the building's yaw.
- **Kerry Park is a terrace laid to the slope**: a 54 x 22 m paved shelf whose
  surface passes 0.1 m over Changing Form's ground and falls 4 % south, a
  retaining wall dropping 2-4 m to the grass, a parapet 1.05 m high. **The
  parapet's height is the design**: from a 1.7 m eye the skyline and the Needle
  stand 0.95 m above it. `landmarkshots --kerry` casts rays from the park
  centre and four more stations at the Needle (base to top) and along a fan of
  the skyline. **It passed on the old model too** (the old plank sat at the eye's
  feet): the old defect was a bare grey slab and a bare wall, not a blocked
  view, so the ray test is a guard against a future parapet that is too tall,
  not proof of this change.
- **The Locks are stacked across the channel, north to south**: small lock,
  centre wall, large lock (with its intermediate gate, which falls where the
  canal's 5.3 m fresh water meets the Sound's in the water mask), south wall
  with the control tower, the spillway dam running on south to the fish ladder.
  The OSM buildings fix the stack (the Control Tower on the south wall,
  Operating House 2 on the centre wall at the intermediate gate, the Locks and
  Dam node at the dam). The 10 m water mask carries the chambers, so only
  walls, gates, rails and the dam are drawn; the walls are walkable.
  **Wall-top height (6.7 m) and the exact z of each wall are est.**

Cost, each built alone (draws / triangles, was -> now): Arch 1 / 76 -> 3 / 4.9k
(a wall texture and the sign atlas), Library 2 / 300 -> 2 / 340 (its lattice
glass replaces the old glass draw), Aquarium 2 / 38 -> 2 / 4.2k, Colman Dock
2 / 38 -> 2 / 1.9k, Kerry Park 1 / 288 -> 1 / 1.2k, Locks 1 / 96 -> 1 / 3.8k:
**+1 draw and +15.6k triangles in all** (all landmarks 66 / 111k -> 67 / 127k).
Build time is the same as the box models: **boxes, posts and ribs go into one
`Acc` per material (`Kit`), not a Mesh and BufferGeometry each**. The first cut
made the Arch's ~480 rib struts as meshes, and building it took 68 ms against
9 ms now (each landmark built alone, best of 6).

Built alone (draws after merge / triangles): Needle 6 / 14.0k, Spheres 5 / 15.0k,
Wheel 6 / 7.3k, arena 8 / 5.6k, Troll 4 / 5.5k, MoPOP 7 / 4.7k, T-Mobile 8 / 4.7k,
Lumen 9 / 4.3k, Husky 8 / 1.5k, Market 7 / 0.8k, Smith 7 / 0.5k. All of them:
100 draws / 68k triangles (was 89 / 27k), but culled per cluster instead of
always drawn, so perfguard's steady draws FELL 221 -> 165 (frame 329 -> 283)
for +1 % triangles, mostly landmark shadow casting.

`node tools/landmarkshots.mjs <dir> [views]` frames views from WORLD target and
camera points, not from the model, so two checkouts photograph the same thing.
It prints each landmark's cost by building it ALONE (a one-element
`G.LANDMARKS` into a throwaway scene), which works on any build.
`--collide` drives a sedan through `player.update` at a fixed 1/60 into a Needle
leg, T-Mobile's and Lumen's walls and the arena, walks into a leg and walks
under the Needle, and reports impact speed, what was hit and whether the car
got through. `LM_PROBE='<expr>'` evaluates a one-off on the same boot.

## Parks

Parks come from the green channel of `surface.png` (OSM `leisure=park`,
`landuse=forest/grass`, `natural=wood` and friends), and `inPark()` is a raster
lookup. Nothing has to keep streets out of them any more: roads go where OSM says
they go, which correctly includes Aurora cutting straight through Woodland Park.

**Which green is which** rides in the mask's value (`G.greenKind`: lawn,
wood, scrub, kept open), from surface.png's blue channel
(`tools/build_wood.py`, OSM's own tags). Trees are planted by `trees.js` --
forest on wood, groves and lined edges on lawn, none on pitches and beaches,
plus street and yard trees: see "A green Seattle" in rendering.md. (The old
scatter was 230 random candidates a chunk, ~14 trees a hectare at best.) A
candidate on a lot is skipped (`G.lotAt`), except that a plaza keeps a third
of its trees — Occidental Square is paving under plane trees. `jank.mjs`'s
`tree-on-lot` counts built trees on non-plaza lots: 0.

### Beaches, landmarks in the parks, park furniture (v118)

**Beaches are sand.** OSM's `natural=beach` polygons were inside the park
mask, so Alki, Golden Gardens and Discovery Park's beaches were lawn to the
water with trees on them. They are lot kind 5, `sand` (`build_lots.py`): the
polygon, plus a band round its outline (20 m wide, 60 m under 3,000 m2),
painted over every other lot and **not clipped by the water mask**. OSM draws
a Sound beach mostly seaward of the coastline (it is the intertidal), and the
drawn shore is where the 40 m terrain rises through the water plane, much of
it on cells the 10 m mask calls wet: clipped, the waterline stayed grass.
Under the water the sand is simply not seen. Discovery Park's South Bluff is
sand too (`BLUFFS`: DEM slope over 0.42 inside a box).

- **Lake beaches were buried by the lake dig.** The bed under a lake's cells
  took the shore with it, so a swim beach had no dry ground. `geo.liftBeaches`
  raises every point of a lake beach within 45 m, below lake level + 0.6, to
  that height, at load, before anything reads the terrain.
- **Props go on dry, level sand** (`beachProps`): umbrellas, towels,
  driftwood, fire rings and volleyball courts at their OSM positions,
  lifeguard chairs and swim rafts at Seattle Parks' guarded lake beaches, by
  kit (`beachKit`: sound, alki, golden, lake, lakeNoGuard, lakeside; fresh
  water if the beach's water stands above 1 m). "Level" is a slope under 0.2,
  or driftwood lies up the bluff. Each beach is its own cluster and draws only
  within 700 m (`updateLandmarkRange`, before the scene pass): eleven far
  beaches in the downtown view cost a draw each.
- **Park buildings are one storey.** Bathhouses, shelters, pavilions and the
  like are bare `building=yes` with a name, which made them 11 m commercial
  blocks on the sand. By name (`PARK_LOW_NAME`) they are 5 m; an untagged
  class 1-2 box under 1,500 m2 in a park is 5.5 m.

**Landmarks added in `geo.EXTRA_LANDMARKS`**, appended after places.json so
activities keeps the same collectibles: West Point and Alki Point lighthouses,
the Fremont Rocket and Lenin, Hammering Man, the Olympic Sculpture Park's
Eagle and Echo, the Typewriter Eraser, Volunteer Park's water tower,
conservatory and Black Sun, Pioneer Square's pergola and totem pole, Changing
Form, and Daybreak Star. Each builder cites its dimensions. A builder faces
its model with `g.userData.rot` (local +z is the front). Gas Works is rebuilt
world-aligned from OSM: the six towers at their lat/lon and published heights,
catwalks, the Play Barn's painted machinery, the picnic shelter, the fence and
the Kite Hill sundial.

- **An extra landmark may pad the terrain** (`pad: { y, r0, r1 }`, `padTerrain`,
  raise-only): both lighthouses stand on points the 40 m DEM has under the
  Sound (West Point -4.1 m, Alki Point -2.9 m), and Echo and Black Sun on
  ground the dig lowered. verify fails if any extra landmark is under its
  local water.

**Park furniture is what OSM maps** (`tools/build_parkprops.py`, one ~2 min
scan: 4.5k benches, 1.1k picnic tables, 640 playgrounds, 290 fountains, none
of them named, so osm_extract's POIs never had them). `world.meshParkFurniture`
draws each chunk's own into its flat mesh: no draws. A bench faces its mapped
`direction`; a playground is a play tower with a slide and a swing set sized
to its area, and park trees keep off it. Tables and play towers are solid.

Cost at perfguard's downtown view: steady draws 141 -> 146, frame 214 -> 222,
triangles +1.8 %. verify's "beaches, landmarks, park furniture" section checks
sand and props at the named beaches, the bluff, dry landmarks and that the
furniture loaded.

## Lots, plazas and yards

**The ground used to know two things: park, or not park.** The lot behind the
supermarket, Occidental Square and every SoDo yard rendered as lawn. OSM has
those surfaces; `osm_extract.py --lots` pulls them (11.8k polygons, 37k service
ways, `raw_lots.json`) and `build_lots.py` bakes them into `data/lots.png`.

**The code.** 0 = none, else `1 + kind * 50 + orientation`, orientation 0..49
over 0..pi (the polygon's min-area-rectangle long side). Kinds: parking
(striped), asphalt, plaza, hard (concrete), rail, sand (code 251 only; see
"Beaches"). **`geo.js` `LOT_ANG` /
`LOT_KINDS` must match `build_lots.py` `ANG` / `KINDS`.**

Sources, lowest priority first: commercial/retail landuse, rail landuse,
industrial/port/garages, parking aisles, forecourts, paved courts, squares and
pedestrian areas, car parks. Then two inferences:

- **Aprons.** Most paved ground is mapped as NOTHING. A non-residential footprint
  (industrial/warehouse -> asphalt; retail/office/school or an untyped
  `building=yes` >= 1000 m2 -> concrete) gets a ring one cell wide, two for
  >= 5000 m2, at the lowest priority of all. This is most of what took
  downtown from 37 % grass to under 15 %.
- **Pocket squares.** Occidental, Westlake Park and Pioneer Square are
  `leisure=park` with no surface tag. A park under 5500 m2 whose 60 m ring is
  >= 33 % MAPPED lot becomes plaza. The test runs before aprons, which would
  talk residential parks into paving.

Clipping: water always wins; the park mask wins over everything except car
parks, squares and courts (a park's own car park is real tarmac, a loose
`landuse=commercial` over a green is not). **A bare `service` way paves only
where land is already developed**: painted 10 m wide everywhere it laid tarmac
ribbons across the suburbs.

**Coverage, not nearest code, and not a distance field.** A 10 m nearest-code
raster (the first version, in surface.png's blue byte) drew its staircase
along every big lot edge from the air. `build_lots.py` paints at 3.33 m, then
samples a 1918² grid (14.4 m) with two bytes a sample: G = the code, R = the
share of that sample's cell that has it. Per candidate code the shader sums
`w * (tap has it ? a - 0.5 : 0.5 - a)` over the four taps and takes the best,
and the zero contour of bilinear box-filtered coverage is straight where the
polygon edge was straight. A signed distance field was tried first and came to
694 KB against 406 KB: in a city where every point is within 20 m of some lot
edge a distance never saturates, whereas coverage is 255 on 95 % of samples.
**Codes cannot be filtered** (two averaged invent a third), so the texture is
nearest with no mips and the shader does its own reconstruction.
`geo.lotCodeAt` is the SAME reconstruction, and every CPU query (`inLot`,
`lotAt`, lot parking) goes through it, so what is planted on and parked in is
what is drawn. `mapdata.js` decodes with `colorSpaceConversion: 'none'`: these
PNGs carry codes, not colours.

**Drawn in the terrain shader, not as geometry.** `buildTerrain` samples lots
as an RG8 DataTexture (6.5 MB GPU): 0 draws, 0 triangles, and — the real reason
— the lot IS the terrain surface. Nothing needs a lift, `groundAt` is already
right, there is no coplanar second surface to z-fight at range, and "The one
height surface" is untouched by construction.

- Asphalt kinds sample the ROAD's albedo, paving kinds the PAVEMENT's, in the
  lot's own rotated frame, so a lot matches the street beside it.
- Bays are 2.6 x 5.4 m, rows back to back across a 7.2 m aisle, an 18 m module
  anchored in world space. **Every scale fades to its own area mean as the
  pixel footprint passes it**, not only the lines: rail's 4.8 m bed banding at
  full contrast to the horizon turned SoDo's yards to beige corduroy. Rail sits
  on dark ballast (~0.15 linear).
- **Asphalt needs low-frequency tone that survives the mips.** Grain averages
  flat from the air, so hundreds of metres of lot were one grey. Lots sample
  `tx.clouds` at 1400 m and 310 m for a +-22 % drift, pale resurfaced patches
  and oil-dark runs. A pavement-map concrete checkerboarded from the air.
- `traffic.updateLotParked` snaps parked cars to the SAME bay grid the shader
  paints: ~16 % of bays within 90 m, at most 6 cars (+18 draws worst case,
  only inside a lot), rescanned per 10 m cell. The minimap draws lots before
  parks, from the nearest sample.

| grass share (`lotshots.mjs --probe`) | before | now |
|---|---|---|
| downtown (r 1.2 km) | 37.2 % | 14.8 % |
| Belltown / SLU | 45.9 % | 21.8 % |
| SoDo | 67.4 % | 4.0 % |
| U Village | 60.0 % | 34.4 % |

Grass share is land samples (5 m grid) that render as lawn: not building, not
road + 3 m pavement, not lot. Draws unchanged; triangles -0.6 % (fewer park
trees).
