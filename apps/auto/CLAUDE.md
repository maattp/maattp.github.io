# Auto

An open-world driving/on-foot game set in a 26 km x 26 km Seattle (`MAP_HALF` 13000), built from
real map data. Landscape iPhone PWA: left thumb stick, right-side buttons, drag
the right half to look.

## Layout

```
index.html                  shell: meta, CSS, HUD DOM, control zones
sw.js                       offline cache (see "Offline" below)
vendor/three-0.160.0.module.js   vendored Three.js (NOT a CDN import)
data/                       the imported city -- see "Where the map comes from"
src/three.js                re-export shim; every module imports THREE from here
src/util.js                 math, seeded RNG, 2D geometry helpers
src/mapdata.js              fetches and decodes data/; the other half of the
                            binary formats that tools/ writes
src/geo.js                  coordinate frame + the lookups over the rasters
src/citygen.js              decodes the road graph and footprints, indexes them,
                            and owns the paved-surface queries
src/build.js                Builder (merged geometry) + mergeByMaterial
src/textures.js             every texture, drawn into canvases at boot
src/world.js                terrain, water, sky, streamed chunks, far skyline
src/landmarks.js            landmarks to published dimensions, + their solids
src/vehicles.js             vehicle models + the arcade driving model
src/traffic.js              traffic AI, parked cars, police, helicopter, A*
src/peds.js                 humanoid builder + pedestrian/cop crowd
src/player.js               on-foot/driving state machine + chase camera
src/controls.js             touch stick/buttons + keyboard fallback
src/hud.js                  minimap, full map, readouts
src/needletop.js            the Space Needle's elevator, deck and viewers
src/hoops.js                basketball courts in the parks + the free-throw game
src/stunts.js               stunt-jump ramps (geometry + height query) and their scoring
src/monorail.js             the Seattle Center Monorail: beams, stations, both trains
src/shadowcache.js          phones: the city's shadows drawn once, only movers per frame
src/effects.js              particles + tracers
src/audio.js                all sound, synthesised: engine models, one-shot bank,
                            positional traffic/sirens, radio (see "Sound")
src/main.js                 boot sequence, game rules, frame loop

tools/proj.py               THE projection. Mirrored by geo.js -- change both.
tools/osm_extract.py        .osm.pbf -> projected raw_*.json  (slow, rare)
tools/build_raster.py       DEM tiles + water polygons -> height/surface/water
tools/build_roads.py        OSM ways -> roads.bin, and the graph assertions
tools/build_buildings.py    OSM footprints -> buildings.bin
tools/build_places.py       landmarks, neighbourhood names, spawn points
tools/build_lots.py         car parks, plazas, yards -> lots.png
tools/build_monorail.py     the monorail's beams, stations, platforms -> monorail.json
tools/build_beaches.py      OSM beaches (from raw_green.json) -> beaches.json
tools/build_parkprops.py    benches, picnic tables, playgrounds, fountains -> parkprops.json
tools/fetch_dem.py          downloads the USGS terrain tiles
tools/render_map.py         draws the whole graph top-down, for eyeballing
tools/verify.mjs            headless CDP boot + assertions + screenshots
tools/jank.mjs, perfguard.mjs, beauty.mjs, survey.mjs, gait.mjs, flycam.mjs,
  crowdshots.mjs, charshots.mjs, vehshots.mjs, landmarkshots.mjs, bldshots.mjs,
  lotshots.mjs, trafficcheck.mjs ...   see "Verifying"
```

## Where the map comes from

Seattle is **imported, not generated**. Streets, shoreline, parks, building
footprints and landmark positions are OpenStreetMap; elevation is USGS 3DEP via
the AWS terrain tiles. Nothing about the city's shape is authored here any more.

```
tools/data/washington-latest.osm.pbf   Geofabrik extract (350 MB, gitignored)
tools/data/dem/*.png                   132 terrarium tiles, z14 (~6.4 m/px)
        |  python tools/osm_extract.py            (~3 min, one full scan)
tools/data/raw_*.json                  projected + clipped intermediates
        |  build_raster / build_roads / build_buildings / build_places
apps/auto/data/height.png     651x651 @ 40 m   h = ((R<<8)|G)/10 - 100
apps/auto/data/surface.png   2601x2601 @ 10 m  R = water, G = green
apps/auto/data/lots.png      1801x1801 @ 14.4 m  G = lot code, R = coverage
apps/auto/data/roads.bin      64k nodes, 70k edges          1.95 MB
apps/auto/data/buildings.bin  125k oriented boxes, chunked  1.51 MB
apps/auto/data/places.json    22 landmarks (Smith Tower last), neighbourhoods
apps/auto/data/water.json     lake surface levels
```

About 3.8 MB, ~2.2 MB over the wire. **Licence: OpenStreetMap is ODbL**, so the
attribution on the launch screen and in the pause menu is required, not
decorative. Don't remove it.

**Re-running the import is a four-command job**, and only the first is slow:

```bash
tools/.venv/bin/python tools/osm_extract.py     # only after a new .pbf
tools/.venv/bin/python tools/build_raster.py    # must run before build_roads
tools/.venv/bin/python tools/build_roads.py
tools/.venv/bin/python tools/build_buildings.py && ... build_places.py
tools/.venv/bin/python tools/build_lots.py      # after build_raster, 4 s
```

`build_roads.py` reads `height.png`, so **the raster step has to run first** or
every road node gets its height from the previous terrain. `build_lots.py`
reads `surface.png`'s water channel, so it runs after the raster step too.
`osm_extract.py --lots` rescans the .pbf for the lot layer alone (~4 min) and
leaves every other `raw_*.json` untouched.

Each tool asserts on its own output and exits non-zero: the raster probe checks
18 points against USGS NED elevations and known land/water, and the road build
checks connectivity and crossings. Believe those numbers over a screenshot.

### The projection

`tools/proj.py` and the top of `geo.js` hold the same constants and the same
formula. Origin `(0,0)` is Westlake Center (47.61134 N, 122.33790 W), `+X` east,
`+Z` south, 1 unit = 1 metre. It is a local equirectangular: over the 8 km half
-width the distortion is under 0.1 %, an order of magnitude below the DEM's 40 m
resolution, so a conformal projection would buy nothing. **If you change one
copy, change the other** -- everything in `data/` is baked in that frame, and a
mismatch moves the whole city relative to its own heightfield.

### What the import made unnecessary

Most of what citygen used to do was repairing damage that hand-drawn data
caused. It is all deleted, and the reasons it existed no longer apply:

| gone | why it existed | why it can't recur |
|---|---|---|
| `planarize()` | 896 crossings carried no node | OSM shares a node at every ground-level crossing, by mapping convention |
| `districtOwner()` | 25 of 32 district polygons overlapped, so two grids met at 58 deg | there are no procedural grids left to collide |
| `dedupeGrid()` | 363 edge pairs were one street drawn twice | a street is in the data once |
| `stitch()` | 99 dead ends and 8 components from where the author stopped drawing | roads end where they really end |
| ~~`roadFit()` / lot shrinking~~ | 880 buildings stood in the carriageway | **it came back — see below. This row was wrong.** |
| `placeTower()` | 17 of 22 towers had a street through them | towers are just buildings, from the same source as the roads |
| `waterDrops` | 182 edges ran through Lake Union | the lakes and the roads come from the same survey |

The measured result, from `tools/build_roads.py`:

| | hand-drawn | imported |
|---|---|---|
| ground crossings with no junction | 896 (pre-planarize) | **0** |
| road-graph components | 8 | 377, but see below |
| separate water systems | 3 | one coastline + 3 lakes |
| landmark position error, mean | ~1000 m | **21 m** |
| landmark position error, worst | 4250 m (Seward Park) | **53 m** |

**Read the component count carefully.** 96 % of nodes are on one network. Of the
rest, the big pieces (Evergreen Point Road, West Mercer Way) reach the map rim:
they connect to Seattle over bridges whose far ends are outside the box, which is
honest clipping rather than a broken graph. The remaining ~1650 nodes are ~338
pockets averaging five nodes, reached in life through a driveway or parking
aisle -- `service` roads, which the extractor drops on purpose because including
them would add tens of thousands of parking aisles. They render and you can drive
on them; they are just not routable. **Deleting them would make the map less
accurate, so the assertion is on a whole neighbourhood being cut off** (largest
inner component < 80 nodes), not on the long tail.

### Traps the import has of its own

**A bare-earth DEM reports standing water's surface as ground.** Straight out of
the tiles, Lake Union is a 5 m plateau and Green Lake a 51 m one, and with a
single sea-level water plane both rendered as solid grass you could drive across.
`carve_lakes()` digs a 7 m bed under every water cell and reports each body's
level; world.js gives each its own plane. Anything measuring clearance over water
has to work from the *local* surface -- a fixed 5.5 m bridge floor put decks
under the lakes they cross.

**A lake is water not connected to the sea, not water that reads high.**
Thresholding on DEM height picks up patches of Puget Sound, which terrarium has
at 2.7 to 5.7 m -- the same band Lake Washington sits in. Label connectivity and
discard whatever component holds an open-water seed.

**Erode the water mask before labelling it.** At the shore the 40 m DEM blends
land into water, so the outermost ring of water cells reads well above sea level,
and that ring is continuous: without eroding it, Lake Washington, Lake Union and
Puget Sound label as one 49 km2 body. Eroding 40 m also parts the ship canal,
which is what separates the lakes from the sea in reality anyway.

**...and a piece the erosion parts from its own lake is still that lake.**
Erosion also cut Union Bay's marshy pocket by Foster Island off Lake
Washington. It labelled as its own "lake", took its level from the DEM's
reading of the marsh and trees (9.9 m, against the lake's 5.09), and got its
own plane, 4.8 m over the lake. That plane covered both carriageways of the
520 where they come off the floating bridge, and the island's trees: "the
520 is underwater near UW". `carve_lakes()` now merges a component into a
bigger body when un-eroded water joins them *within the piece's own box*.
Through the whole mask, Lake Union would join Lake Washington, and both
would join the sea. It merges exactly that one piece today. `AUTO_DATA_OUT=<dir>
python3 tools/build_raster.py` writes somewhere else for a diff; the shipped
rasters rebuild byte for byte.

**The coastline flood fill needs a closed barrier.** Coastline ways alone don't
close it -- the fill walks around the outside and the entire map comes back as
ocean (99.7 %). Seal the padded grid's border too. And seed from known open water
rather than deriving the wet side from OSM's land-on-the-left rule: that is one
assertion instead of 2258 guesses, and the probe catches it if it's wrong.

**Some OSM `height` tags are storey counts.** Benaroya Hall is tagged `height=4`,
which taken literally is a 6100 m2 building four metres tall -- it rendered as a
white plain across the middle of downtown. A small whole number on a footprint
over 600 m2 with no `building:levels` is treated as levels. Six buildings in the
box trip this and they are all landmarks.

**Bridge decks: don't put `elev` in the node key.** A bridge and its approach
ramp share an OSM node, so keying node identity on the elevated flag splits that
junction into two nodes at the same spot and leaves every deck disconnected from
the street network. Decide which nodes are on a deck afterwards, from the edges:
a node is elevated only if everything meeting it is.

**Roads over water are piers now, not mistakes.** citygen dropped them, because
with a hand-drawn shoreline an edge over water meant one of the two had drifted.
With both sides real it is Alaskan Way or Colman Dock and it is *supposed* to be
there -- dropping them tore a hole in the waterfront route. 56 edges get a low
deck instead. This is the opposite of the old rule and worth knowing.

### How accurate it actually is

Landmark meshes sit a **mean 21 m and at worst 53 m** from their true lat/lon,
and most of that residual is the difference between a POI node and the centroid
of the complex it names, not error. `tools/verify.mjs` asserts this on every run.
For comparison, the hand-drawn map averaged about a kilometre and put Seward Park
4.25 km from where it belongs.

Building heights: 125k footprints, 23 over 100 m, 9 over 150 m, tallest 259 m
(Rainier Square, which is its real height). Real Seattle has about 25 buildings
over 100 m. Only 3 % of footprints carry a height tag overall -- but that is
dominated by 100k houses, which correctly take a 6.4 m default; downtown the
coverage is 55 %, and 72 % for footprints over 1200 m2, which is why the skyline
comes out right.

Footprints are reduced to their **minimum-area oriented rectangle**, not kept as
polygons. Buildings land in the right place at the right size, orientation and
height, which is what reads from a car; the corner detail of 125k footprints does
not. That is also what lets world.js's existing rectangle mesher, facade system
and box collision keep working untouched.

## Keeping the roads clear

Three passes, all at load time and all measured. They exist because "the data is
real, so the geometry is right" turned out to be false in three different ways.

**`roadFit()` came back, and the note that deleted it was wrong.** "A real
footprint is not standing in a real road, because the road is real too" is true
of the FOOTPRINT and false of what actually ships, which is the footprint's
minimum-area oriented rectangle. An L-shaped or U-shaped building's bounding box
covers the notch, and a street through that notch is under the box. Measured:
**11,131 boxes (8.9%) overlapped a carriageway, 8,290 of them by more than 3 m**,
including a 274 x 68 m box sitting 38 m into I-5. The pass shrinks a box to clear
the carriageway and drops it only if that would take it under 4 m a side --
12,039 shrunk, 3,172 dropped, and the overlap count is now **0**. It clears the
carriageway only, not the pavement: real buildings front the pavement, and
clearing that too shrinks most of downtown for no gain in drivability.

It runs at load time over the shipped boxes rather than as a filter in the
importer, so the correction travels with the geometry and cannot go stale
against a re-import.

**`roadCoveredAt()` was suppressing real tarmac.** The old test skipped a road's
surface wherever its CENTRELINE fell inside a wider road's half-width. A
motorway's half-width spans several lanes, so *every ramp running beside it
qualified*: **30% of all ramp segments were drawn with no surface at all**, plus
9-13% of every other class. That is what "I-5 isn't fully navigable" was -- you
took an off-ramp and there was nothing under you. Two fixes: require the roads to
be near-parallel (a crossing at a junction has each centre inside the other and
neither is redundant), and test **containment** rather than centreline proximity
-- a road is only redundant where its whole width is inside the other's. Ramps
went 30% -> 8%, arterials/streets/residential 9-13% -> **0%**. A tunnel, which is
still drawn at ground level, may never suppress the street above it. **And two
roads are only one surface where their drawn heights agree** (within 5 cm,
`drawnY`: the graded profile or terrain + `ROAD_LIFT`). A ramp just past its
diverge is still inside the main line's width -- coupling skips 30 m along the
graph -- but has already climbed 0.1-1 m, and its tarmac was dropped as
"covered" while groundAt kept carrying cars on it: ~20 of the contract probe's
misses (see "What you drive on is what is drawn").

| skipped as "already paved" | before | after |
|---|---|---|
| ramp | 30% | 8% |
| hwy | 8% | 6% |
| art / st / res | 9-13% | 0% |

**Trees plant themselves on roads unless told not to.** Parks are a raster of OSM
greenspace and real roads run through them -- Aurora crosses Woodland Park, Lake
Washington Boulevard runs the length of its own. 6.4% of sampled carriageway
centres sit inside the green mask. `inPark()` knows about grass, not about
tarmac, so the scatter asks `city.onRoad(x, z, pad)` as well. Anything else
scattered on the ground needs the same call. **Nor does it know about lots**:
OSM draws a park's own car park inside the park, so trees also skip
`G.lotAt()` (a plaza keeps a third of them; see "Lots, plazas and yards").

**And they plant themselves in the sea.** The green mask and the water mask are
separate rasters whose shorelines do not agree to the metre, so `inPark()` says
yes on cells that are under Puget Sound. **63 trunks** stood in the water. The
scatter tests `G.isWater()` plus a 0.35 m floor for the shoreline band where the
40 m DEM blends land into sea.

**Do not reach for `waterLevelAt()` to do it.** It answers over a lake's
axis-aligned BOUNDING BOX, so it reports Green Lake's 50.3 m for the whole park
ringing it — testing terrain against that level deleted 105 of Green Lake's 717
trees and 251 around Lake Union. The water mask is the authority on what is wet;
a lake's level is a reference height, not a region test.

**Ground tint: tarmac is built-up too, and `SUBURB` has to look different from
`GRASS`.** Two separate bugs made the I-5 trench through Chinatown render as a
lawn. `builtAt()` counted building footprints only, and a freeway corridor has no
buildings in it -- it now adds paved area per chunk, so "urban" means buildings
OR pavement. And `SUBURB` was `[0.48, 0.60, 0.37]` against `GRASS`'s
`[0.42, 0.62, 0.28]`: the same colour to within a rounding error, so ground that
had blended all the way to "fully developed" still came out a bright meadow.

**Widths: `lanes` counts the lanes on THIS way, and OSM splits a divided road
into one way per carriageway.** A motorway way is half the freeway, not all of
it. The old floor (`CLASS_HW * 0.72`) was 10.8 m for anything tagged motorway,
which made every I-5 carriageway 21.6 m wide whether it carried three lanes or
six. `CLASS_MIN_HW` is per-class and low enough that the lane count actually
drives the width.

### Pavement, roofs and water surfaces

**Pavement must not cross a carriageway, and geometry alone will not enforce
it.** Strips stop at `nodeRadius` along their own direction, but a pavement is
offset SIDEWAYS by `hw + sw`, so near a junction its far corner can sit in the
cross street even though its centreline stopped short -- and with real data a
road that does not meet this node at all can pass close enough to be underneath
it. Both the strips and the junction ring now test themselves against
`city.onRoad()`. Measured at the spawn, 5.64 % of pavement vertices sat on a
carriageway, the worst 8 m deep; now 0.7 % and 0.67 m.

Two traps in writing that test. Sample the piece's MIDDLE, not its inner edge:
a pavement's inner edge lies on its own carriageway's boundary by definition, so
testing it rejects every piece in the city -- the first attempt deleted 95 % of
the pavement. And sample a grid across the piece, because three samples down the
centre catch head-on overlaps but miss a piece clipping a junction corner
diagonally. `onRoad()` takes an `includeElev` flag for this: scattered props
must respect a viaduct overhead, pavement must not.

**A roof has to know which way its house is facing.** House roofs were
`cone(..., max(w, d) * 0.74, ..., 4, ...)` -- a square pyramid sized off the
LONGER side, and `cone()` takes no rotation, so it stayed axis-aligned in world
space while the house was turned by `bd.rot`. On a 6 x 14 m house that is a 10 m
square roof at the wrong angle, missing the walls entirely on the narrow axis.
`meshGable()` builds a gable in the building's own frame with the ridge along
the longer side. **Its normals have to turn with it.** They were written in the
house's frame but passed in unrotated, and `Builder.quad`/`tri` wind each face
to agree with the normal they are given. On a house turned past about 90 deg,
the "-z" slope's normal pointed into the roof, so that slope and a gable end were
wound inward and backface-culled. From the street, most houses showed one bare
slope over an open end, a lean-to slab, on master and on every build since the
gable was added. `meshPyramid` had the same bug. Any builder that places
vertices through a rotation has to rotate its normals through the same one. Smith Tower's cap had the same defect: a 4-sided `cone` puts
its vertices on the axes, so it is a diamond in plan, 45 deg out from the square
tower under it.

**Nothing may stand above the water that covers it.** The minimap is drawn from
the water mask and the world from the DEM, so the two disagreeing looks exactly
like an island that is not on the map -- 938 sea cells stood above sea level.
Subtracting a fixed depth is not enough wherever the DEM and the mask disagree.
Every wet cell is now clamped below ITS OWN water surface: 0 for anything the
sea flood reaches, the body's own level inside a labelled lake (Green Lake
really is at 50 m), and the local DEM for ponds too small to label -- Volunteer
Park Reservoir sits at 130 m and must not be dug to sea level.

**`ROAD_LIFT` is 0.30, not 0.22.** Adaptive tessellation got terrain poking
through the asphalt from 139 cm down to about 28 cm, but a road quad is a chord
and some residue is unavoidable on a curved 40 m heightfield. 28 cm through a
22 cm lift is grass growing on the road; 30 cm clears the measured worst case.
The kerb is still 22 cm (`WALK_LIFT - ROAD_LIFT`).

### The road surface itself

**Coplanar asphalt is what "messy" looked like.** `roadCoveredAt` only drops a
surface whose whole width is inside another's -- it has to, or every ramp beside
a motorway loses its tarmac -- so partial overlaps are drawn, and they used to be
drawn at exactly the same height. A raycast over one freeway found a second road
surface within half a metre behind **129 of 148 sampled pixels**. Coplanar quads
z-fight, and because the two face slightly differently it reads as soft dark
blotches smeared over the road rather than as obvious flicker, which is why it
looks like a texture problem and is not one. Each edge now takes a deterministic
`hash2(ei, 7) * 0.03` lift, so overlaps resolve instead of fighting: median
separation went 0 -> 29 mm and 93 % of coplanar samples cleared. 3 cm is far
under the 22 cm kerb, so `roadLift` doesn't need to know.

**Don't diagnose this from a render.** Nulling the albedo, the normal map, the
roughness map and the vertex colours in turn all failed to explain it, and a
luminance dump of the road texture came back flat (84-93 across a 16x16 grid).
Raycasting the offending pixels and asking what was behind them found it in one
step. Same lesson as the wheel-well slab in "Vehicles".

**Lane markings are geometry, not texture.** They used to be painted into the
asphalt texture, which forced one repeat to stretch across the full road width so
the lines landed at the edges and the centre -- and that tied the ASPHALT's grain
to the road's width too: 1.8 cm per texel on a residential street, 5.3 cm on a
27 m highway, so the aggregate became gravel on anything wide. The texture now
tiles at a fixed `ROAD_TILE` metres and `meshRoadMarks()` lays lines down in real
metres: 12 cm wide, 3 m dashes with 6 m gaps, on every class. Under 4 m of
half-width gets nothing, which is what an alley has.

**Nothing scattered may stand on a carriageway, including above one.**
`city.onRoad()` deliberately counts **elevated** edges: anything placed on the
ground under a viaduct grows straight through the deck, and there was a pine tree
in the middle of the I-90 bridge because it didn't. Street furniture needs the
same check for a different reason -- it offsets sideways from its own road, which
beside a ramp lands it on the freeway.

**Survey the freeways specifically, and pose the camera.** `tools/survey.mjs`
poses a camera on the carriageway looking along it, at a spread of sites. Two
things it got wrong at first and now doesn't: it skipped elevated edges, so every
viaduct in the city went unlooked-at; and it posed the camera without moving the
sun, whose shadow camera is only ~105 m wide and follows the player -- the stale
shadow map painted dark blotches on the asphalt that looked exactly like the bug
being hunted.

### Terrain through the tarmac, and cars that won't sit down

**A road quad is a chord, and its error grows with the square of its length.**
`meshRoad` used fixed 16 m pieces spanning the FULL carriageway width, sampling
terrain only at the four corners. McGraw Street on Queen Anne drops 5.4 m across
one such piece and the chord cut **1.39 m** under the crest -- terrain standing
proud of the asphalt, which is grass growing over the road. Pieces are now sized
from the terrain, and subdivided across the width as well as along the length
(~8 m cells; the heightfield is 40 m, so finer than that buys nothing).

Sizing needs **both** tests, taking whichever is finer. Gradient alone misses a
road that is level end to end but crests in the middle -- the downtown case. Bow
(the sag at the midpoint) alone misses one whose crest is off-centre or is
S-shaped, where the midpoint happens to land on the chord; measured on its own it
was *worse* than the gradient test on Queen Anne, 36.7 cm against 11.8 cm.

| worst terrain above the asphalt | before | after |
|---|---|---|
| Queen Anne | 139 cm | **12 cm** |
| downtown | 106 cm | **24 cm** |
| West Seattle | -- | **3 cm** |

Under the 22 cm `ROAD_LIFT` nothing shows through, so that is the number to beat.
Costs about 6 % more triangles and no extra draw calls.

**Paint stops short of a junction, like the pavement does.** Markings that run
end to end lay each road's edge lines straight across every cross street it
meets: white lines cutting the carriageway diagonally, centre dashes doubling
back. `meshRoadMarks` trims to `nodeRadius` at both ends of an **at-grade
junction** only. A crossing is mostly bare tarmac in life too. Along a graded
chain (see "Freeway grading") a node is not a crossing, so paint runs through
it and stops instead where it would cross another carriageway.

**`rotation.z` raises local +X, so the far side is the one you subtract.** The
body attitude used `atan2(rh - lh, ...)` with `lh` sampled along local +X, which
leans the car INTO the slope instead of along it. On a 2.4 deg cross-slope the
+X wheels sat 7.2 cm under the road and the other pair floated 7.1 cm above it --
the two-wheels-in-the-air. `place()` had the same inverted formula, so parked
cars leaned wrong too.

**A car rides the plane through its four contact patches, not the ground under
its centre.** On a crest the centre reads high and the wheels hang; in a dip it
reads low and they sink. Both `update()` and `place()` now average the four wheel
samples. Measured after both fixes, all four wheels sit within 0.2 cm of the
ground on a Queen Anne cross-slope, against +/-7 cm before.

**A motorcycle has TWO of them, both on the centreline.** `spec.moto` switches
`update()` and `place()` to the front/rear pair only. The cross-car samples are
taken at `halfWid` either side, which for a bike is the gutter and the crown of
a road it is nowhere near, so averaging them sinks or floats it by half the
camber. It also takes two `groundAt` calls a frame instead of four.

**A junction square is a chord too, and it was the last big one.** `meshNode`
drew the crossing as ONE quad up to ~9 m across, sampling terrain at its four
corners; `groundAt` samples the heightfield at the exact point. Those are
different surfaces the moment the ground is not planar, and at a residential
crossing whose corners spread 2.4 m the drawn square stood **0.67 m** above the
height you were standing at — you sank into your own junction. The corner
samples were never wrong; the middle was. It subdivides into ~4 m cells now,
exactly as `meshRoad` does. Measured on a 5x5 grid across that crossing:

| gap between drawn surface and standing height | one quad | ~4 m cells |
|---|---|---|
| worst | 74.2 cm | **31.3 cm** |
| mean | 31.1 cm | **9.8 cm** |
| samples over 10 cm (of 25) | 22 | **7** |

Going finer does not pay: at 2.5 m cells the mean improves to 5.6 cm but the
worst does not move at all (31.3 cm), so the residual there is not the square —
and the extra triangles regress `trisFrame` past the guard. **Don't screenshot
this one.** The tarmac is continuous either way and before/after renders are
indistinguishable; the defect is where you *stand* relative to what is drawn, so
the raycast is the evidence and a picture is not.

**Gate that subdivision on BOW, not on spread.** A junction on a uniform grade
has a large corner spread and is still exactly representable by one quad,
because a plane is a plane. What one quad cannot follow is curvature — the
centre's deviation from the plane of the corners. Gating on spread subdivided
nearly every junction downtown (Seattle is hilly) and saved almost nothing:
432814 triangles against 432214. Gating on bow costs +2.7 % steady triangles and
passes `tools/perfguard.mjs --check`.

**The junction ring may not override the strip scan, however wrong the scan
looks.** `roadLift` used to taper a pavement's lift to zero across its last
`RAMP` metres, so a point under the ring could pick up a small tail — 0.06 m —
and the ring's 0.52 m was discarded, leaving you 0.46 m inside visible pavement.
Taking the ring wherever it is higher is the obvious fix and it is **wrong**:
`nodeSurface` reports the ring as a plain box, but `meshNode` cuts the ring up
and drops the pieces covering each approach, so over an approach the ring is
reported and not drawn. Measured, that override moved `sink` 11.8 % -> 12.44 %.
The pavement taper is gone now (see "Pavement verges"; `RAMP` only edges a road
with no pavement), but the rule stands: the ring answers only where the scan
found nothing -- for the legacy square's ring. A fitted junction (see
"Junctions, dead ends, bridges") is that proper fix: `nodeSurface` reports
exactly the corner quads drawn, so there the corner does override the scan.

## What the map looks like from above

Still the cheapest way to find a layout bug, and none of it is visible at street
level. `tools/render_map.py` draws the whole graph over the water and park masks,
with elevated spans in red. It should read as Seattle at a glance: Elliott Bay,
the ship canal, Green Lake, downtown's grid rotated ~32 deg off true north, I-5
running north-south, I-90 and SR-520 crossing Lake Washington, and a red mark at
every real bridge.

**Ground colour is blended from real building density.** `city.builtAt(x,z)` is
the footprint area packed into each 400 m chunk, so the edge of the city follows
the city instead of a rectangle. The query point is still pushed around by smooth
noise and sampled three times, because the chunk grid is 400 m and a straight
lookup draws its staircase on the ground.

## Input lifecycle (never latch a held pointer)

`pointerup` is not guaranteed. iOS steals the gesture at a screen edge, an
overlay can open under the finger, and a captured element that gets
`display:none`'d on a mode switch drops its pointer silently. The rule:

- **No input path may refuse a new press because an old one is still "held".**
  `onStickDown` used to `return` when `_stickId` was set, so one missing
  `pointerup` latched the stick at its last deflection *and* made it impossible
  to ever grab again — the reported "stick stuck in one direction". Last touch
  wins instead.
- Held presses listen for `lostpointercapture` as well as `pointerup` /
  `pointercancel`; that is the event you actually get in the failure cases.
- `setMode()` clears every button, because switching foot/drive hides the button
  set that may be under a thumb (exiting a car with GAS down stuck the throttle).
- `blur` / `pagehide` / `visibilitychange` call `resetAll()`.

Backgrounding has the same shape of trap one level up: **pause through
`setPaused`, never by assigning `game.paused`.** `visibilitychange` used to set
the flag directly, which stopped the world without showing the pause menu, so
returning from the home screen looked exactly like a hung game — the only way
out was the pause button, which is not what anyone taps on a frozen app.
`setPaused(false)` also calls `audio.resume()`, because iOS suspends the
AudioContext on the way out and does not hand it back.

Regression test — dispatch synthetic `PointerEvent`s and simply never send the
`pointerup`, then check a fresh press re-acquires:

```js
const z = document.getElementById('stickZone');
const ev = (t, id, x, y) => z.dispatchEvent(new PointerEvent(t,
  { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
ev('pointerdown', 1, 100, 300); ev('pointermove', 1, 180, 300); // stick.x === 1
ev('pointerdown', 2, 100, 300);                                 // must re-grab
__dbg.controls.stick.x; // must be 0, and _stickId must be 2
```

## Heading sense (the sign trap)

`heading` is literally a three.js `rotation.y`, so **forward = `(sin h, cos h)`**
and heading `0` faces `+Z`, which in this world is *south*. That makes the sim
consistent with the models (a car's local `+Z` is its nose) but it has one
consequence that is easy to get backwards:

> **A larger heading rotates anticlockwise — i.e. it turns LEFT on screen.**

So anything converting a screen-space or compass-space intent into a heading has
to flip the horizontal sign. The three places that do:

- `player.updateDrive`: `steer = -input.x`.
- `player.updateFoot`: `Math.atan2(-input.x, -input.y) + camYaw + PI`.
- `hud`: minimap rotates by `camYaw` (not `-camYaw`), the minimap arrow uses
  `camYaw + PI - heading`, and the north-up full map uses `PI - heading`.

`util.dirDeg()` is the *other* convention (compass bearing, `0` = north,
clockwise). It is only used for district grid axes in geo.js — never for an
entity heading. Don't mix them.

The minimap's **north tick** falls out of the same rule. The map image is drawn
world-aligned and then turned by `camYaw`, and north is `-Z` (heading `0` faces
`+Z`, which is *south*), so north lands at `(sin camYaw, -cos camYaw)` from the
centre — the direction that was straight up before the rotation. It's drawn
outside the rotated transform so the letter stays upright at any bearing. That
expression is the same one a blip at `(p.x, p.z - d)` resolves to, which is the
cheap way to re-check it if the map transform ever changes.

To check a change, don't reason about it — measure. Project a world point to
NDC and see which side of the screen it lands on:

```js
// facing heading 0, world +X must land at NEGATIVE ndc.x (screen left)
new THREE.Vector3(p.x + 30, p.y + 1, p.z + 40).project(__dbg.camera).x
```

## Rendering pipeline

Physically-shaded, image-based-lit, tone-mapped, with a hand-rolled post chain.

- **The sky is a shader dome, and the same shader is the IBL.** As
  `scene.background` the old painted equirect was 2048 px across 360 deg, so a
  62 deg view magnified it 3.6x and its cloud ellipses smeared into brush
  strokes. `world.buildSky(sunDir)` draws a `ShaderMaterial` dome that computes
  gradient, sun glow and disc per pixel and projects a tiling fBm cloud field
  (`textures.cloudNoise()`, 512 px periodic value noise) onto a flat layer, so
  clouds foreshorten toward the horizon. It replaces the background's own draw
  (`scene.background = null`), so the draw count is unchanged.
  - **Not tone-mapped, on purpose.** three leaves an sRGB background out of ACES,
    so the old sky's authored colours were the screen colours and the fog was
    tuned against them. The dome keeps `toneMapped: false`.
  - The vertex shader drops translation and writes `z = w`; with depth test and
    write off and `renderOrder -1000` the dome is infinitely far at any
    altitude, and depth stays 1.0 under it, so SSAO's sky test still works.
  - **One GLSL `skyColor(dir, forIbl)` feeds both** the dome and a 2048x1024
    8-bit equirect target, and that target goes through `PMREMGenerator` into
    `scene.environment`. The canvas equirect is deleted. Below the horizon
    `forIbl` swaps the haze for the old IBL ground ramp (#8b979f -> #5a6469), so
    the diffuse bounce every material was tuned against is unchanged and only
    what reflects changes. The upper hemisphere is multiplied by `iblGain` 1.35:
    without it street shadowQ fell 0.035 -> 0.023 and downtown's median to 0.051;
    with it every median is within ~10 % of the painted sky's.
  - **IBL is the ambient.** The analytic lights are only a key plus a fill, so
    `envMapIntensity` on a material is the main dial for how a surface reads in
    shade.
- **`PMREMGenerator` is the one half-float exception, and it's guarded.** It
  hard-codes `HalfFloatType` targets internally with no capability check, which
  is exactly what the rest of the pipeline avoids. `halfFloatRenders()` draws a
  white pixel into a half-float target and reads it back before `buildSky` trusts
  it; a definite black falls back to the 8-bit dome render as `scene.environment`
  (`world.envPrefiltered === false`) — no prefiltered roughness mips, so rough
  surfaces reflect too sharply, but the city stays lit instead of going dark.
  Anything that makes the probe inconclusive counts as a pass, so hardware that
  renders correctly today keeps the PMREM path.
- **Tone mapping is ACES, and getting it to run at all took a flag.**
  `WebGLRenderer` applies `toneMapping` only when the current render target is
  null -- when it draws straight to the canvas -- or when the target is marked
  `isXRRenderTarget`. The whole scene goes into postfx's 8-bit target, so for a
  long time **ACES and `toneMappingExposure` never ran**, and this file claimed
  they did. Highlights had no shoulder and hard-clipped to flat 255 plateaus
  that read as missing textures; the scene floor sat where the toe should have
  been, so light added at the source was eaten before it reached the
  framebuffer (hemisphere and ambient pushed 2.6x bought 1.6x on screen) and
  three separate value bugs were attacked through albedo instead. The tell was
  that moving exposure 1.02 -> 1.55 changed the measured output by less than a
  thousandth of a stop. `postfx.sceneRT.isXRRenderTarget = true` is the only
  way to get the curve applied before an 8-bit target quantises the highlights;
  it is pinned to the vendored r160, so **re-check it on a three bump**.
  Exposure lives in main.js and is meaningful now -- tune it against
  `tools/values.py`, not by eye.
- **Every surface is a set**: albedo + normal + roughness (+ emissive where there
  are lit windows). Normals are sobel'd from a purpose-drawn *height* pass, not
  from the albedo, so window reveals read as recesses.
- **`postfx.js` is deliberately not three's EffectComposer** — no addon files, and
  every render target can be `UnsignedByteType`. Half-float targets are
  unreliable on iOS (silent black screen), so the scene is tone-mapped into an
  8-bit sRGB target and bloom / FXAA / grade / vignette all work in gamma space.
  If you add a pass, keep it 8-bit.
- **Key-to-ambient is the whole look.** At hemisphere 2.0 against sun 2.5, with
  full IBL on top, ambient dominated at roughly 1.3:1 and two faces of the same
  building differed only by texture, never by light. Nothing downstream can read
  under a shadowless sky -- AO, normal maps and geometry all score flat however
  good they are. It is now nearer 4:1 (hemi 0.55, sun 3.6, envMapIntensity
  roughly halved on every material, exposure 1.25). **Change this ratio before
  reaching for any other visual fix**, because everything else is measured
  against it.
- **SSAO is ON at `high` only** (`ssaoOn = q === 'high'`; 12 taps on desktop,
  8 on a phone). It reads the scene pass's own depth attachment
  (`postfx.sceneRT` carries an integer `DepthTexture`, filled for free), runs
  half res, and multiplies BEFORE bloom. It first shipped off because it halved
  street value (street 0.156 -> 0.076). That was three bugs, not a strength
  problem:
  1. **Face the depth normal toward the camera, not toward +Z.** `n.z < 0 ? -n : n`
     is only right for a level or down-pitched view. Pitch up a degree and open
     ground's normal flips into the road, and every nearer ground sample is an
     occluder: street, shopfront and facade (all looking slightly up) lost about
     half their value, residential (looking down) 9 %. Face by `dot(n, P) > 0`.
  2. **"Is this sample buried?" is decided by pixel rounding at grazing angles**
     (one road pixel 20 m out spans ~0.35 m of depth). It is a horizon-style
     estimate over the points actually drawn instead: sine of their elevation
     above the tangent plane, squared (a 30 cm step barely counts, a wall does),
     times a `1 - d²/R²` falloff. Depth reads snap to texel centres.
  3. **The bilateral blur rejected nothing**: `exp(-|dz| * 0.02 / (1 - z))` is
     `exp(-0.02 * dd/d)`. It weights by linear relative depth now (sharpness 12).

  **Occlusion is gated to 0.7-1.2 m above the tangent plane.** Pavements stand
  0.45-0.9 m proud of the terrain beside them (lifts plus chord error), and
  scored honestly they drew a dark band along every verge. Cars, walls and
  building bases survive the gate; kerbs and paved lifts do not, so AO sees no
  under-car clearance and no window reveals (those are normal-map only). The
  composite takes a multi-bounce fit (Jimenez 2016, frame luminance as albedo),
  because AO multiplies sunlight too here and bright pavement must not dim.
  Radius 2 m growing with distance to 3x, fade 90-220 m, strength 14.

  | lower-half median (`values.py`) | AO off | AO on | shadowQ off | on |
  |---|---|---|---|---|
  | street | 0.1567 | 0.1555 | 0.0322 | 0.0295 |
  | shopfront | 0.1731 | 0.1679 | 0.0475 | 0.0449 |
  | facade | 0.1085 | 0.1081 | 0.0170 | 0.0168 |
  | residential | 0.1339 | 0.1315 | 0.0540 | 0.0509 |
  | downtown | 0.0639 | 0.0612 | 0.0280 | 0.0266 |

  Open-road smudge (pixels darkened > 4 %) on the street carriageway crop went
  53,360 -> 31 of 53,550. Cost: 3 half-res passes (AO + 2 blur), 17 depth taps
  per AO pixel (13 on a phone), no draws. **Judge it off vs on in ONE boot**,
  so traffic and frame are the same, and reset every uniform to its default
  between configs: one config's setting leaking into the next made two
  different settings measure identical for an afternoon.
- **Dither belongs in the output pass, not in the sky.** Baked into a sky
  texture it magnifies across the screen as clumped grain, shows up on the water
  as well, and pollutes the IBL the same texture feeds. It is screen-space,
  +/-1/255, after tonemap.
- **The grade split-tones by luminance.** Lifting blue across the whole range and
  then warming the whole range back cancelled itself. Highlights push toward
  amber (+0.022, +0.008, -0.018 above ~0.42) and shadows toward sky blue
  (-0.014, +0.002, +0.020 below ~0.38). Arithmetic in the grade, no extra pass.
- **Per-building colour varies TONALLY, in families.** Jittering R, G and B
  independently manufactures a candy palette; jittering one base colour per style
  instead produces a whole downtown of the same beige. `tint()` shares its
  brightness jitter across channels and pulls toward grey, and
  `buildingFamily()` picks one of eight named families weighted by height.
  **A family needs its own MATERIAL, not just its own tint.** With one wall
  texture, concrete, stucco and red brick were three values of the same thing
  and a street of five families still read as one stone -- no tint can turn
  ashlar into a running bond. `masonrySurface()` is parameterised and called
  twice, for stone and for brick.
- **One material for every wall, and the tiling is what makes that hard.**
  `Builder.box` emits UVs running 0..n and leans on `RepeatWrapping`, and GL
  repeat wraps the whole texture rather than a sub-rect, so a naive atlas cannot
  carry a tiling surface at all. `facadeAtlas()` lays the families out in a
  HORIZONTAL strip one tile tall: V still wraps natively, so a 100 m tower's
  seven vertical repeats cost nothing, and only U has to stay inside a cell —
  which `box` does by cutting a face into one quad per horizontal repeat. Plain
  textures, plain UVs, no `onBeforeCompile` and no `sampler2DArray`: the same
  reason postfx.js is 8-bit throughout is the reason this route was taken over a
  shader one. It costs about 41 % more facade triangles (0.2 % of the frame) and
  saves 91 draw calls downtown.

  Everything that used to differ per material is baked into the maps, because
  one material has only one of each: `normalScale` into the normal's xy (three
  scales the DECODED vector then normalises, so pre-scaling by `ns / nsMax`
  reproduces the old value exactly), `roughness` and `metalness` into their own
  channels, and `envMapIntensity` into the AO channel — three's AO term
  attenuates the image-based light, which is the only thing env drove. Emissive
  spans a hundredfold (a lit shop sign against a lit office window) and survives
  anyway because the map is **sRGB-encoded**: the window lands on texel 31, not
  on texel 2.

  **Glass stays its own material.** It is the one facade whose look is mostly
  indirect SPECULAR, which is the part of `envMapIntensity` the AO channel can
  only approximate.

  Cells carry 8 px of wrap-padding — the cell's own opposite edge — so bilinear
  and the first three mips filter as if the tile repeated rather than pulling in
  the neighbouring family.
- **Quality is MANUAL ONLY, and it persists.** The adaptive ladder is gone,
  by explicit request: it watched fps with no idea why a frame was slow,
  demoted players after warps (the post-teleport streaming burst is CPU that
  a lower tier cannot help), and kept overriding a deliberate choice. The
  pause-menu picker is the single authority; the choice is saved to
  localStorage ('auto-quality') and restored at boot.
- **Tunnel interiors are drawn UNLIT** (the glow material), light baked into
  vertex colours: lamp pools every 18 m, walls lighter than the ceiling, a
  warm strip overhead. Sun-lit materials inside a bore sit in the shadow
  map's darkness and render near-black -- "you can't see anything" -- so the
  interior owes the sun nothing and reads the same at any depth.
- **Haze thickens with altitude** (fog density up to 3.2x by ~480 m). The
  streaming rings -- massing at 1.6 km, detail at 800 m -- are a crawling
  boundary from a plane, and no draw budget pushes them past a 6 km
  sightline; atmosphere hides them honestly. Past that, the far massing layer
  (see "Flying") stands in for every building the rings have not delivered,
  and the far roads for every road — supertile layers, not wider rings.

## Shadows: snap the box, fade its edge

**Shadow crawl was the shadow box moving by sub-texel amounts.** The sun and its
target were re-centred on the player every frame by whatever fraction of a
texel they had moved, so the map was rasterised at a new sub-texel phase every
frame and every shadow edge in the city crawled as you walked or drove.
`placeSun()` in main.js projects the box centre onto the shadow camera's right,
up and forward axes (built once with `Matrix4.lookAt` from `SUN_OFFSET`, the
same basis three builds per frame), rounds each to `shadowTexelM` (2S/mapSize)
and rebuilds the position. A move then redraws the same map shifted by whole
texels. **Depth is snapped too**: it moves no texels, but it shifts every stored
depth by a fraction and the PCF compare flips on a grazing roof.

Measured with the camera held still and only the shadow centre moving, reading
the scene pass from `postfx.sceneRT` (before post, so dither is excluded), a
pixel counted when any channel moves > 3/255:

| churn per step | 5 cm before | after | 2.3 m before | after |
|---|---|---|---|---|
| downtown street | 0.125 % | **0.000 %** | 0.164 % | **0.000 %** |
| commercial street | 2.180 % | **0.000 %** | 4.560 % | **0.001 %** |
| houses | 0.682 % | **0.000 %** | 1.612 % | **0.000 %** |

**Rotation must not enter the box.** `SUN_OFFSET` is fixed, so only translation
needs snapping. If time of day is ever added, the basis has to be rebuilt and
the map re-rasterises while it turns: rotate in discrete steps, or accept the
swim while the sun moves.

**The box edge fades.** Past the ortho box three returns "lit", a hard line that
slid across the street as you turned, because the box follows the view.
`installShadowFade()` patches `shadowmap_pars_fragment` to fade shadowing over
the last 7 % of the box (~36 m at desktop's 260 m half-width, ~27 m at the
phone's 190 m). It is a string replace pinned to r160: it warns and leaves the
chunk alone if the text changes, so **re-check it on a three bump**.

## Surfaces: glass, windows, roofs, trees, ground

**Glass reflects the sky, pane by pane.** A vertical mirror seen level or from
above reflects the IBL's ground half, so every tower read as dark blue paint.
The glass material alone re-includes `envmap_physical_pars_fragment` with the
reflected ray folded into the upper hemisphere (`y = abs(y) * 0.85 + 0.12`),
and a per-pane hash tilts the normal up to ~2 deg for a curtain wall's
patchwork. Glass is metalness 0.58, env 1.15.

**Masonry windows carry per-window state and real reflection.**
`packedCell(..., winMetal)` bakes metalness 0.6 and full env into the glazing
texels of the stone and brick cells — glazing is the only content under ~0.3
roughness there, so no second map. `metalMax` is 0.6 (industrial's 0.25 rides
as 0.25 / 0.6). The facade shader hashes window column, storey row and building
into a dark room, blinds or a cold pane, and **divides the building tint back
out of the glazing**: a metallic pane takes F0 from albedo, so on brick every
window mirrored the sky in red.

**A per-building hash must not read vertex colour VALUE.** `Builder.box`'s baked
AO scales the tint toward the ground, so vColor changes continuously up every
wall, and hashing it through `fract(sin(...))` re-rolled every window per
PIXEL: blue-white static on every masonry facade. Seed from the tint's channel
RATIOS (quantised r/g and b/g), which a uniform scale leaves constant under
interpolation. Anything hashing per-building state out of vertex colour has the
same trap.

**Every lidded roof drew a flat deck 2 cm under its lid, and 93.8 % of
non-house buildings carried it** (62,576 of 66,743). One 24-bit depth step at
near 0.5 is `z^2 / (0.5 * 2^24)`: 0.48 cm at 200 m, 1.91 cm at 400 m, so from
~400 m out the two tops share a step and every low roof in an aerial z-fought.
The deck is skipped where a lid exists, and the dark parapet sits at w+0.75 so
it clears the kit's parapet (w+0.5) by 12 cm, not 2.5. Roofs take their own
`roof` atlas cell (seams, ponding, patches, drains) at 10 m a tile. **Any two
coplanar-ish tops need more separation than one depth step at the farthest
distance they are seen from**, not at street level.

**Trees are lit volumes** (`meshCanopy`): conifers are five 8-sided skirts
brightening toward the leader; broadleaf crowns are a dark core, four jittered
lobes and a crown lobe, with the lobes on the sun's side (`SUN_OFFSET` xz) in a
yellower lit foliage colour, so the crown reads as a volume at any heading.

**The ground map is sampled at three scales.** One 13 m tile was the whole city
floor: blurry underfoot and a visible grid from the air. `buildTerrain`'s
`onBeforeCompile` adds 75 m macro patches and 3 m grain, each normalised by the
map's mean (0.44 linear) so the average value does not move. `SUBURB` is
`[0.47, 0.53, 0.38]` — GRASS's hue at low chroma; `[0.52, 0.53, 0.41]` came out
khaki dirt after ACES and the grade. It must stay distinct from GRASS (see the
I-5 trench fix). Water takes a second normal tap at -0.29x the scale drifting
the other way, blended in tangent space, which breaks the 16 m tile weave into
longer swell.

## Judging how it looks

Four separate visual bugs were each diagnosed two or three times as something
else, because the thing doing the judging was wrong. The rule that came out of
it: **measure the composited frame, and check the harness before the renderer.**

**A check that re-derives its own answer measures the map, not the game.**
`tools/jank.mjs` had two of these. `tree-in-water` re-implemented the scatter's
filters and counted the points that passed — which is a property of the rasters
and never changes, so it reported an unchanged 16 before and after the scatter
was fixed and could not have detected its own fix in either direction. Against
the trees that actually get planted the real figure was **63**. `roof` had the
same shape, and a first attempt at fixing it made things worse rather than
better: the check was changed to ask the mesher's own `World.gables()` guard,
which made the condition `aspect > 4.5 && aspect < 4.5` — a tautology that
reports 0 however the mesher behaves. **If a check and the code under test each
hold their own copy of a threshold, the check is decorative; if the check asks
the code under test whether the code under test did its job, it is worse than
decorative.** `tree-in-water` now reads `city.obstacles`, the record
`buildChunk` writes as it plants each trunk.

**The `roof` check was deleted, because its defect did not exist.** It counted
footprints more elongated than 4.5:1 — a threshold invented in the check and
never checked against `meshGable`, which sizes eaves from the actual `w` and `d`
(a fixed 0.45 m overhang) and runs the ridge along the longer side. Measured on
the three footprints it named, contiguous roof past the narrow wall was 0.4 /
6.0 / 5.8 m with the gable built and 0 / 6.0 / 5.8 m with it **suppressed** —
the metres are neighbouring terrace roofs, which touch and cannot be separated
by contiguity. A guard was briefly added to skip gables on elongated houses;
that was a regression on three correct terraces, and is reverted.

**Settle the streamer before raycasting anything.** Chunk geometry is
time-sliced, so one `world.update` builds a few milliseconds of it and returns.
Querying straight after measures a half-built city: every worst-point diagnosis
came back `drawn: null` because the road mesh did not exist yet. Note
`world.update`'s `budget` argument is **not** a millisecond budget — it is read
only as a `< 2` flag and the function then picks its own 2/4/9 ms slice — so
settling means calling until nothing is pending (~243 calls cold, ~126 for a
neighbouring site). Settling is far too expensive to do per sample: work
site-by-site, settle once, then take every sample inside the built area.

**`city.obstacles` is a flat stride-3 array** (`x, z, r, x, z, r, …`), one per
chunk — not a list of objects. Iterating it as objects matched nothing and
reported a clean `0 of 0`, which is the most dangerous possible result: a green
number that means "measured nothing at all". Always check the denominator.

`tools/beauty.mjs` captures a fixed set of framed views; `tools/values.py`
reports the linear value structure of the resulting PNGs -- percentiles, the
median of the lit and shadowed quartiles, and the ratio between them. A daylight
open world of the target era runs a lit-to-shadow ratio of roughly **2.2-3.3:1**.
At 13.8:1 the shadows are night values under a daylight sky, and no amount of
albedo tuning fixes it, because every base colour is being multiplied by an
ambient term near zero.

**Measure the PNG, not the scene pass.** `renderer.render(scene, camera)` in a
probe skips the whole post chain, and AO, grade and vignette are a large part of
where the values land. A probe that renders directly reported a shadowed
quartile of 0.19 for a frame whose actual pixels were at 0.004 -- a factor of
fifty, in the direction that hides the bug.

**The harness lights the shot, so the harness can be the bug.** `beauty.mjs`
used to place the sun relative to the camera and aim it at the LOOK-AT point.
That is fine for a shot 20 m deep and badly wrong for one 2400 m deep: the
skyline view ended up with the light 240 m above a target 2400 m away, a sun
**5.7 degrees above the horizon**. Every up-facing surface in the aerial got a
tenth of the key and the mid-ground rendered as a black band. It reproduces
main.js's own `(-215, 200, -150)` offset now. Same class of error as the stale
shadow map in `survey.mjs`.

**Spawning is not placing.** Traffic and pedestrians set their logical position
on spawn; only each system's `update()` moves the meshes. The beauty shots pause
the game so the camera can be flown, so for several passes they counted a dozen
vehicles in the frustum and drew none of them. Seed, then step the systems.

**Frame the views from the map, not from coordinates.** Hardcoded camera
positions went stale the moment the city became real data -- the shot named
`park` contained no park and `residential` framed an office block, so vegetation
and housing were never actually being looked at. The views resolve at capture
time from the loaded city: densest cluster of `style === 'house'`, densest
cluster of buildings over 60 m, the fully-green patch nearest downtown.

### Four bugs that all looked like a material problem

- **A shadow with no bottom is the shadow map running out.** A tower's shadow
  was sliced off mid-facade in a straight vertical line. The ortho box was 190 m
  and shadowing simply stops at its edge. The proof is one render: widen the box
  and previously *lit* pixels go dark. No real shadow gains area when you
  enlarge the camera that draws it.
- **Vertex tint multiplies the windows too.** Glazing drawn at `rgb(36,48,58)`
  and then multiplied by a red-brick family colour lands at `(29,18,16)` --
  black holes, on brick buildings only. Panes start bright now, which is also
  what a daylight window actually is: mostly a reflection of the sky.
- **Banding in the sky was the cloud generator.** 390 ellipses squashed to about
  a fifteenth of their width at 3-11% alpha are individually invisible and stack
  into continuous horizontal streaks across the equirect. It was twice blamed on
  dither and precision in the post chain. (The painted equirect is gone now —
  the dome's clouds are fBm — but the diagnosis generalises.)
- **A canopy built from `prism` has no top or bottom.** `Builder.prism` is an
  open drum, so a squashed one seen from eye level is a single band of vertical
  wall -- the "green slab on a stick" that trees rendered as. `spheroid` is
  closed and costs about the same.

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
  `landmarks.userData.solidsDropped` — today the convention centre (I-5 runs
  under it) and the ferry terminal (Colman Dock's vehicle lanes). **A dropped
  solid usually means the MODEL is on the road too**: Smith Tower's east wall was
  dropped until its lot was clipped clear of the street (`clipHalf`), because
  OSM's lot runs to that street's centreline.

**Greenspace and footprints are separate OSM layers and they overlap.** Park
polygons are mapped straight over the museum, pavilion or house standing in
them, so `inPark()` happily says yes in the middle of a building: 9.3 % of
surviving park-tree candidates stood inside a footprint. Anything scattered on
open ground needs `inBuilding()` as well as `inPark()` and `onRoad()`.

## Models

Cars and characters are the two things a player looks at closely, and both are
built rather than blocked out:

- **Vehicles** (`vehicles.js`) loft a shell through ~26 sampled cross-sections.
  The bottom edge of that profile **arches up over each wheel** (`archLift`) —
  without the cut, tyres just intersect a straight sill and the whole thing
  reads as a toy. Three geometries per type share materials across all
  instances: `paint` (tinted per car), `trim` (glass/chrome/lenses/rims,
  metallic; the glass is see-through) and `matte` (tyres/plastic/arches, the
  cabin and its occupants). See "Every vehicle type has an authored builder"
  and "Vehicle glass is see-through" below.
- **Characters** (`peds.js`) are `SkinnedMesh`es: one draw call each, but with a
  22-bone skeleton (`BONE_COUNT`), so elbows, knees and fingers actually bend.
  Geometry comes from a pool of 12 designed looks plus 4 cop looks
  (per-instance variety is skeleton, scale, colours and gait), with a sculpted
  head, textured from one atlas, and `animateWalk` is a procedural cycle —
  counter-rotating chest, level head, breathing idle, and the legs described
  below.

### Every vehicle type has an authored builder

The generic loft (one `section` tube, triangle-fan end caps, boxes for lamps,
slab boxes for glass) used to build ten types. On a short car the flat caps are
most of what you see, so they read as bread loaves with lamp "ears", and the van
and bus wore their glazing as boxes standing off the sides. **`HAND_BUILT[spec.hand]`
is mandatory; `buildType` throws on a type without one.** A new type is a table
of stations over shared pieces, not 90 copied lines:

| helper | what it builds |
|---|---|
| `greenhouse(paint, trim, matte, g)` | the four-panel greenhouse (screens, roof, side glass, pillars from the panels' own edges). `pillarInto` / `roofInto` move pillars or roof to another builder (black pillars, glass roof on the EV); `rearY` above the deck adds a painted tailgate, because a hatch's rear glass run to the beltline is one black slab |
| `bodyCore(...).surf(z, s, i, d)` | a point on the DRAWN shell (end roll-in applied), `d` out along the section; `onShell` lays a lens or strip on it |
| `boxShell(into, cfg)` | a tall painted volume, flat sides, radiused roof edge — van and bus upper bodies, truck cabs, cargo boxes. Glazing goes ON it (`sideGlass`, `slopeGlass`) a few mm proud — lofting those bodies in glass turns the upper half into one dark slab |
| `truckCab`, `archCut`, `shellArch` | cab-over or bonneted cab with a squared front arch cut into the shell's bottom edge |
| `scaledBuild(build, refLen, refWid)` | runs an authored builder at its own size and scales vertices (normals by the inverse). Taxi and police are the sedan; wheels scale in position only, since `addWheel` builds them round afterwards |
| `aerofoil(b, col, stations, o)` | NACA 00xx skins through span stations for wings, tailplanes, fins (they were 18 cm boxes) |

Traps:

- **`endFace` must band at every outline station**, not only at hole edges. A
  face with no holes became three quads whose top one ran from full width down
  to the crown's zero: every cargo box front was a triangle standing over the cab.
- **A bright lens straight on the paint reads as a chrome shard.** `trim` is
  metalness 0.88, so a lamp patch on the wing mirrors the sky with nothing dark
  round it. Headlamps sit in a gloss-black housing (`headlampWrap`); red tail
  lamps on red paint have no sky to mirror and survive.
- **Valances tuck under the fascia.** A matte box 10 cm inside the end with
  22 cm depth pokes 1 cm past the face and reads as a black tray.
- **Liveries are spec, not spawner.** `spec.livery` overrides the colour in the
  `Vehicle` constructor; a taxi in a random colour is just a car with a sign.
- **Kerb side is -x**: `laneOffset` puts a vehicle heading +z at -x of the
  centreline, so bus doors are on -x.

### Vehicle glass is see-through, and still 3 draws a vehicle

- **Glass lives in `trim`, flagged per vertex.** `tagGlass()` gives every trim
  geometry a `glass` attribute (1 where the vertex colour is exactly `GLASS`)
  and reorders the index buffer so glass triangles come LAST. `glassShader`
  (trim's `onBeforeCompile`) turns those fragments into a dielectric pane:
  metalness 0, roughness 0.05, the reflected ray folded into the upper
  hemisphere like the curtain wall's, opacity
  `mix(GLASS_ALPHA 0.55, 1, (1 - N.V)^5)`.
- **The blend is premultiplied** (`CustomBlending`, ONE / ONE_MINUS_SRC_ALPHA):
  the reflection adds at full strength and only the tint scales the cabin.
  Straight alpha dims the reflection with the cabin and reads as grey film. Fog
  is corrected for it after `fog_fragment`.
- **The whole trim draw is in the transparent pass** (depth writes on). Opaque
  trim has alpha 1 and draws as before; the glass-last index order is what
  stops a pane depth-rejecting chrome behind it in the same draw.
- **`GLASS` is a MARKER colour now.** Anything dark that must stay opaque takes
  another one: door-mirror faces are `MIRROR`, because as glass they showed the
  empty pod behind.
- **A 4th glass material was measured and refused.** With 30 fixed civilians at
  perfguard's downtown camera: glass in trim 3.07 draws a vehicle, 437 a frame;
  a separate glass mesh 4.07 and 467 (+7 %), past perfguard's 4 % tolerance at
  ~14 cars, for no visual gain. Opaque Fresnel glass costs nothing and cannot
  show a cabin: it reads as a better-reflecting slab.

**What is behind the glass has to exist.** `carCabin(matte, g, paint)` builds
from the same greenhouse stations that drew the glass: floor, dash, seats (back
plus headrest on two posts — the gap is what reads as a seat), headliner,
wheel rim. **Drape the floor on the deck** (`deckAt()`): a flat floor at the
glass line showed body colour behind a hatch's rear seats. `boxCabin` (van,
truck, ambulance cabs) takes `sit`, the seated-shoulder level; `busCabin` has
no liner walls, because a bus is seen through.

- **Occupants are `matte.crew`, merged only into occupied geometry**: `matteGeo`
  (player), `matteGeoW` (traffic), `matteGeoWE` (parked, empty). `Vehicle.mode`
  is a setter that swaps the last two, so traffic.js and player.js make no
  calls. `scaledBuild` scales the crew too.
- **`boxShell` glass needs real openings.** Van, truck, ambulance and bus panes
  sit a few mm proud of the painted shell, and see-through they showed the
  livery. `boxShell({ windows, slope })` takes the `sideGlass` / `slopeGlass`
  arguments, adds their stations as ring stations and skips those quads
  (`Builder.loft`'s `skip(i, k)`). Flat end-face screens are `endFace` holes.
  Glass over solid lower body or a skin (bus doors, plane windows) is backed in
  dark matte instead.

Cost: +6.5 % triangles a traffic vehicle (weighted, 6,378 -> 6,791), bus +22 %,
box-shell trucks +13 %; perfguard's frame draws and triangles unchanged within
noise. Overdraw is the glazed area only.

### Characters: atlas, hair, looks

- **One 2048x1024 atlas** (`drawAtlas`, drawn at boot), one material, still one
  draw a character. The left square is the 4 x 4 grid of 256 px cells: cells
  5-15 are greyscale detail that MULTIPLIES the vertex colour (knit, jacket,
  denim, shoe, hair, hand, skin, hoodie, skirt, curly, uniform). Multiplied paint
  can only darken, so anything that must be the brightest thing on a garment
  (hi-vis bands) is geometry. The right square holds the five painted FACES,
  one per skin tone, at 512 x 341 (`faceRect`), on WHITE head vertices so the
  paint shows (skin encoded to match the neck, because vertex colours are
  linear and the map is sRGB). At 256 px a face was stretched ~3x at portrait
  distance and every feature came out a grey-brown haze. 10.7 MiB with mips.
- Parts map cylindrically round their own axis; `SkinAcc.add` repairs the back
  seam per triangle or every feature smears down the back. The face cell wraps
  +-100 deg of the head (`HEAD_SPAN`), chin to just over the hairline: ~500 px
  across the face. Shading the modelled head now does itself (jaw, chin,
  philtrum, nose sides) is NOT painted; lips, nostrils, a nose sheen and a lit
  chin are.
- **Features are paint, not geometry.** 3-6 mm eye/brow/mouth boxes read as
  stuck-on plates up close and, thinner than a depth texel, shimmered from
  across the street. Same for thin torso boxes (a placket): paint them.
- **Hair GROWS from the drawn head, not from the ellipse** (`buildHair`, over
  the head's own `grid`). Lofted shells with open bottom rings came out a bowl
  however the rings were treated. Hair columns ARE the head's columns: each
  shell point is `grid.at(j, y)` plus the head's NORMAL times thickness, at
  least **1.6 mm**. Offset along the ray at 1 mm it dipped under the head's
  triangulation (raycast: 0.2 mm out, then -0.6 mm) and the two fought. Each
  column starts at its own edge height (hairline, temple, sideburn, over the
  ear, nape); rows run edge, one between, then ON the head's own top rows,
  because a straight chord between rows anywhere else cuts inside the dome. Cap
  the crown, or the skull shows through as a pink smudge. The buzz cut is a
  3.5 mm shell: painted, its edge was one straight line with a pale band under
  it. Jitter the edge only at the sides and nape, clip strand strokes at the
  hairline, and paint the band above the hairline as skin, or a white line
  shows across every forehead.
- **Garments read at twenty pixels by their boundaries, not their grain.**
  Collars, hoods, cuffs, turn-ups, hems, belts are geometry; pockets, zips and
  ribbing are paint at 40-60 % value. Sleeves take the plain cell — a torso cell
  mapped round an arm puts pockets on the sleeves.
- **The pool is designed, not rolled** (`LOOKS`, via `buildCharacter({ variant })`).
  Twelve hashed looks came out with no buzz cut and no dress but five skirts and
  four side parts. Colours, skin, build and shoes still come from the seed.
  Shoes skew dark; off-white is one in six, because a white pair was the
  brightest thing on the pavement.
- **Cops have their own pool** (`copVariants`, `makeHumanoid({ cop: true })`):
  pooled characters ignore opts, so cops used to be civilians in random shirts.
- **Feet stay 12-sided.** At 10 the ring has no vertex at +-z, the heel and toe
  move ~5 mm in, and that breaks `SOLE / HEEL_Z / TOE_Z` (see the gait).

### Characters: head, hands, hood

**The head is sculpted** (`headGrid`, `faceRelief`). `SKULL` is only the base:
the head is `HEAD_COLS` 32 x `HEAD_ROWS` 20, columns dense across the face
(0/3/7/12 deg at the nose and mouth), 10-26 deg apart round the jaw and cheek
(at 13-32 they showed as facets on every silhouette), and each vertex
is the base ellipse plus a relief (brow ridge, sockets, cheekbones, nose
bridge/tip/wings/columella, philtrum, lips, chin, jaw angle, muzzle).
`faceParams(seed, soft)` gives each pooled look its own features; `soft`
(skirt, dress, long, bun) softens jaw and brow.

**Judge the head in clay first** (`CHAR_EVAL` swapping the material for a
plain grey, on a buzz cut: `CHAR_OPTS='{"unique":true,"variant":2}'`, views
`face,face34,profilehead`). Painted, v118's head passed for a face; in clay it
was a flat oval, and that is what "his face looks really weird" was. v119:

- **The chin comes forward and narrows.** Off an adult profile the chin's
  front is 10-11 cm ahead of the ear and 4-5 cm wide; the rings had it 8 cm
  ahead and 8 cm wide -- a profile with no chin and a jowly jaw.
- **The face has a front plane**: a relief term turns the temples, the cheek
  behind the cheekbone and the masseter away round the sides. Sockets, brow,
  nose (tip 26.5 mm), cheekbones, lips and chin boss are about 40 % deeper.
- **The skull is a dome**: three rings over the hairline keep its breadth to
  within 3 cm of the crown. It was a cone from the hairline, and every buzz
  cut and hat was a pointed egg. The hair grows on every head row over the
  hairline (`tops` in buildHair), so adding a row there is safe.
- **The neck is 11-12 cm across and rises behind the jaw** (8.8 cm, straight
  up under the head, was a lollipop's stalk). `NP` in buildCharacter mirrors
  the neck rings for the hood and long hair; change both.
- **The hairline dips** 8 mm in the middle of the forehead and rises to the
  temples. It may not rise over `HAIRLINE`: the head is not drawn above it.

- **Relief moves a vertex ALONG THE RAY FROM THE UV AXIS `(0, HEAD_Z)`** at its
  column's angle. The face cell is a cylindrical projection round that axis, so
  UV depends on column and row only and sculpting cannot slide the painted eyes
  off the sockets. Put a new feature where `drawAtlas`'s `hp()` paints it: eyes
  +-21 deg; brows eye + 21 mm; nostrils eye - 47 mm; mouth chin + 45 mm.
- **The mouth needs a muzzle term, and the nose a columella.** Without the
  dental arch's forward push the lips sat in a dish; with the nose's whole
  underside running back to the lip in one row, its shadow smoothed onto the
  upper lip. Under a top light both read as a moustache on every face.
- **The lower face was still muddy, and neither cause was the sculpt.** Each
  was isolated by removing shadows, AO and map in turn (`CHAR_EVAL`):
  - **Self-shadow at building texel size.** The sun's texel is 0.25 m and its
    normal bias 0.12 m; a head is 0.23 m. `pedMat.onBeforeCompile` lifts the
    shadow lookup 0.60 m toward the sun, scaled by the length of the shadow
    matrix's depth row so it holds for any box. A body can no longer occlude
    itself; a building still shadows a pedestrian. **It is a string replace on
    r160's `shadowmap_vertex` and a silent no-op if that text changes.**
  - **Smoothed normals at the subnasale ring.** A white, unshadowed, unpainted
    head still showed the band. `creaseNoseBase` splits the normals per vertex
    across the nose and fades the split out by 16 deg; a per-quad weight or a
    per-quad face normal made blocks.
  - The painted face adds a soft sheen down the nose bridge and on the tip:
    seen straight on, the nose's front plane was the cheeks' value and the tip
    dissolved into them.
- The head is drawn only up to the hairline ring; every style and hat covers
  the rest. Ears (`buildEar`, a rim round a sunken bowl) are skipped under
  covering styles (long, curly, side), where they would poke through.

**Hands have fingers** (`buildHand`, `digit`, `FINGERS`). A flat palm facing the
thigh, four smooth-shaded fingers in a relaxed cascade (curl increasing toward
the little finger) and a thumb, ~196 triangles a hand. **Finger bones are
APPENDED** (fingL/tipL/fingR/tipR, indices 18-21), so every older index keeps
the meaning gait.mjs reads. The relaxed curl is in the bind pose and the bones
only add to it: a loose fist with `runBlend` in `animateWalk`, and
`gripHands(h)` (pronates and closes; `makeRider` calls it). Curl is
`rotation.z` with sign `-side`. Digit skin weights are looked up by exact vertex
position in a Map, which is exact because Builder copies corner arrays verbatim.

**Hood and long hair lie on the body.** The hood grows from the torso's own
rings (`tRings`) along their normals, full thickness down the spine and diving
INTO the torso at its edges, so there is no ledge; rim and lining ride the neck.
Three ovals behind the neck was a pillow. The long curtain starts UNDER the
shell and comes out from beneath its edge (started on top it made a shelf),
keeps 10 mm off the body (`bodyAt`), ends on the shoulders, and rides the chest
below the jaw — at 40 % head it went into a runner's upper back.

Cost: a pooled look is **3,869 triangles mean** (v119; 3,389 before the
denser head), head 1,094, hair 483, hands 392. Still one
draw a character and still pooled; 24 pedestrians with desktop shadows is ~20k
triangles more a crowded frame, ~1.7 % of perfguard's 1.18 M, and perfguard is
unchanged within noise. Building the 12 looks takes 41 ms in Node. Phones cast
no ped shadows, so there it is one pass. `tools/gait.mjs` output was
byte-identical across the head, hand and hood work.

### The gait plants feet, it doesn't swing legs

`animateWalk` places each **foot** and solves the knee to reach it. A leg
alternates a stance half-cycle, where the foot holds a spot on the ground, and a
swing half-cycle, where it arcs forward. Rotating the hip on a sine cannot plant
a foot, and legs paddling under a gliding body is what reads as flailing.

**Everything here is judged by `tools/gait.mjs`, not by looking at it.** The rig
drives one character at a fixed 60 Hz across five speeds, with the root
TRANSLATING, and reports cadence, step, duty, double support, flight, hip
height, joint ranges, world-space skate of the heel/toe pivot, sole contact
(stance gap, mid-swing clearance, ankle on its limit) and a speed ramp
0 -> 1.4 -> 5 -> 7.2 -> 5 -> 1.4 -> 0 m/s through `player.updateFoot`'s damp
(worst planted-sole slip, worst ankle second difference — a pop is a change of
velocity, not a speed). `--trace` prints the frames around the worst pop.
**Every published band passed while the stride still looked wrong**, because
the rig did not yet watch the sole or a speed change: the foot landed toe-first
(stance pitch had the wrong sign — +x on the foot bone lowers the toe), planted
soles hovered or sank 3-9 cm, planted feet slid 26-33 % of body travel, and
every stop popped a sole 11.5 cm in one frame. If you change the gait, run it.

The laws:

- **The foot is rigid and rolls.** One flat-foot origin travels back at body
  speed while down; one sole pitch (toes up at heel strike, flat, heel up to
  ~50-60 deg at toe-off); the ankle is wherever a rigid foot pivoting on its
  heel or toe at that pitch puts it. **`SOLE / HEEL_Z / TOE_Z` in animateWalk,
  the shoe loft's bottom ring in buildCharacter and `soleOf` in gait.mjs are the
  same numbers — change one, change all three.** Ankle height, excursion and
  pitch as three separate dials is what made soles hover.
- **Planted feet are locked to the world.** `h.locks` remembers where a foot
  touched down; the leg is solved to that spot (sagittal and lateral) until it
  lifts, and the offset fades over the swing. Analytic stance targets only hold
  at constant speed and heading. **Callers must place the group BEFORE calling
  animateWalk** (`player.updateFoot` and `PedSystem.update` do), or the lock is
  a frame behind. `dt = 0` means "pose at this phase" and bypasses all history —
  the strip and portrait harnesses rely on it.
- A lock is dragged, never re-planted: past 0.5 m from the analytic spot (warp,
  wall, hard stop), or further out than the stride ever puts a foot (`zLimit`),
  or the hips ride a foot left 86 cm behind and squat.
- **Each foot finishes its own half-cycle** (`h.gst`). Stance and swing are cut
  from one phase circle at `stanceSpan`, which moves with speed; a foot keeps
  its own progress, changes state only at the end, and catches up 0.04 of u a
  frame. **The cycle runs on a smoothed speed** (`h.gspd`, ~0.17 s), because
  the player's speed damps at rate 9 and re-shaped the stride every frame.
- **The stance window is balanced, not hand-set**: `back` is bisected so heel
  strike and toe-off limit the hips equally. A symmetric window lunged the
  front leg out straight.
- **Hip bob is explicit**: a walk takes a fixed 4.5 cm of the reach circle; a
  run sinks 3.5 cm under the scissored height plus a 5 cm flight arc; never
  above what the planted leg reaches.
- **Swing has zero vertical speed at both ends**: Hermite along z with backward
  end slopes (late-swing retraction), lift a smoothstep rise times a smoothstep
  fall. A sine over `u^p` has infinite slope at toe-off and lifted a sprinting
  ankle 21 cm in one frame. Toe clearance is a floor (~2 cm), not a by-product.
- **Double support exists.** `dutyFactor()` goes above 0.5 below about 2.5 m/s
  and the stances overlap; `h.contactL` / `h.contactR` are per-foot because the
  single `h.contact` cannot express it. Duty is 0.03 lower once running.
- **Gait keys off `runBlend`, not raw speed.** People change gait around
  2.5-3 m/s; clearance, lean, elbow carry and arm swing key off that blend.
- **Idle is blended in, not switched** (legs on idleW², after the upper body);
  switching at `A < 0.05` was the pop on every stop. A runner's arms drive back
  and come forward only to the ribs.

**Every band passed while the whole stance was spent in a crouch** (v118):
the planted knee never went under 25 deg and averaged 36 at a walk, against a
real 5 at heel strike and 10-20 through loading -- a Groucho walk, which is
what "he walks kind of weird" was. None of the rig's bands measured the stance
knee; the joint-angle curve over one cycle (thigh, knee, ankle, pelvis,
shoulder, elbow against normal-gait curves) showed it, and `gait.mjs` now
bands the mean stance knee (`stance-knee`; v118 fails it at every speed). Laws from it (v119):

- **`REACH_PLANT` may not be a few percent short of the leg.** On a nearly
  straight leg a sliver of length is a lot of knee: 97.3 % of the leg is 26
  deg of bend. It is `LEG * 0.998 - 0.003` at a walk; animateWalk takes
  another 11 mm off at a run (`RP`), where the pelvis rolls its sockets up.
- **In double support the LEADING foot holds the hips**, and the trailing
  foot rolls further onto its toes to keep reaching (`reachToe`, up to
  `TOE_MAX` 80 deg, faded out over early swing like a lock). Pinned to the
  trailing foot's scheduled roll, the hips sank through every weight
  acceptance and the new stance knee buckled to 38 deg.
- **A runner's hips are limited by what the toe can reach** (`reachOf`),
  and that reach grows from heel-off to toe-off (`toeCap`). Switched on at
  heel-off, a foot locked far behind let the hips jump 22 cm in one frame.
- **The hips may not RISE faster than 1.5 m/s.** Accelerating through the
  gait switch, the flight arc (computed from the analytic stride) snapped
  them 10 cm above where a locked toe-off had held them.
- **Step length is `0.40 + 0.245 v`** at a walk (0.74 m, 113 a minute), back
  to 0.45 across the switch: at 0.79 the lead foot landed 0.39 m out, a
  person's ~0.3.

Current figures, all inside their bands:

| | cadence | step | duty | bob | knee swing | hip height | stance knee (mean) | skate (world) | mid-swing clearance |
|---|---|---|---|---|---|---|---|---|---|
| walk 1.4 | 113 | 0.74 m | 0.61 | 4.1 cm | 71 deg | 97.5 % | 10 deg; was 30 | 2.9 % | 6.7 cm |
| brisk 2.2 | 140 | 0.94 m | 0.52 | 4.7 cm | 72 deg | 96.6 % | 9; was 33 | 3.2 % | 6.8 cm |
| jog 3.5 | 161 | 1.31 m | 0.40 | 7.8 cm | 101 deg | 91.9 % | 39; was 52 | 5.0 % | 18.7 cm |
| run 5.5 | 183 | 1.80 m | 0.32 | 7.9 cm | 114 deg | 91.3 % | 43; was 56 | 6.0 % | 23.5 cm |
| sprint 7.5 | 196 | 2.29 m | 0.26 | 9.6 cm | 123 deg | 91.8 % | 43; was 57 | 4.9 % | 28.1 cm |

Ankle on its limit 8-32 % of a cycle. Speed ramp: worst ankle pop 9.8 cm/frame
(touchdown at a 7.2 m/s sprint); worst planted slip 8.1 cm/frame (was 4.2), a
toe dragged the frame it is held past toe-off while accelerating into a
sprint, when the body covers 12 cm a frame. It comes from the hips riding
higher, not from the toe roll (7.2 with reachToe off).

**The old note here said a run's 87 % hip height was "honest, not a crouch",
and it was a crouch**: the 87 % came from the 26 deg floor above plus a fixed
3.5 cm sink. The earlier warning still stands -- do not shorten the ankle
excursion by a fixed "roll" the sole never rolls through; reachToe pivots the
sole on its real toe, so the stance gap is still 0.1-0.2 cm.

On-foot pace is **5.0 m/s running and 7.2 sprinting**. It was 3.6/5.4, lowered
at some point to stop the gait reading as track athletics -- which was the wrong
lever, because the gait keys off `runBlend` and the rig judges it at 1.4/3.5/7.5
where it already passed. The pose was never the speed's problem, and a 26 km
city at 3.6 m/s is a chore.

Two standing traps. `animateWalk` owns `h.phase` -- advancing the cycle anywhere
else reintroduces the cadence/stride split. And the bones are **unscaled**, so a
step in world metres has to be divided by `h.scale` or taller pedestrians
over-stride.

The reference bands in `tools/gait.mjs` are published adult gait-analysis
values -- cadence and step-length curves, duty factor against speed, joint-angle
ranges -- so the rig judges against an outside standard rather than against a
screenshot.

### The Space Needle

The Needle is `src/needle.js`, built to published dimensions. The reference
table at the top of that file gives each number and its source: 605 ft to the
beacon, the 500/510/520 ft top-house levels, SkyLine at 100 ft, a 102 ft base
circle, the 373 ft waist, the 42 m halo, 48 barriers leaning out 14 degrees,
and Astronaut White, roof included, since May 2023. The profile the sources
leave out was measured off Commons photographs. The legs are three pairs of
columns swept through a monotone-cubic radius profile. They are welded into
one blade from 79 to 128 m and fork into Y arms above that. **Leg thickness is
tuned to the distant read, not only to the drawings.** With legs of about
1 m, which is what the drawings imply, the dark core was the only thing
visible from 500 m and the tower read as a black pole. Legs sized to look
4-5 m wide from Kerry Park, as they do in photographs taken there, restore the
white hourglass. The Needle has its own materials (`NEEDLE_MATS`), so
`mergeByMaterial` returns meshes that belong to the Needle alone.
`buildLandmarks` names them `spaceNeedle`, culls them on their own bounds and
lets them cast and receive shadows. That is 6 draws and about 14k triangles.
The two glass materials fold the reflection into the sky hemisphere, the same
way the curtain wall in world.js does. `node tools/needleshots.mjs <dir>`
frames nine views from the landmark's own position: plaza, base, under,
street at 590 m, tophouse, Kerry Park at the game's FOV and at telephoto,
aerial, and 4 km toward Beacon Hill. It also prints the Needle's draw and
triangle cost.

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

Tree scatter is *candidates per chunk*, filtered by `inPark`. At 46 a
chunk-sized park got one tree per 60 m and read as bare ground; it is 230 now.
If you add a large park, check it doesn't look empty. A candidate on a lot is
skipped (`G.lotAt`), except that a plaza keeps a third of its trees —
Occidental Square is paving under plane trees. `jank.mjs`'s `tree-on-lot`
counts built trunks on non-plaza lots: 0.

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
samples a 1801² grid (14.4 m) with two bytes a sample: G = the code, R = the
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

**A scrape is not a crash.** `collideWithBuildings`' obstacle/barrier branch
(every vehicle, player and traffic) took 80 % of the speed on every contact
frame whatever the angle, so a vehicle grazing a wall side-on lost it each
frame it stayed in touch and wedged at full throttle — a bus on SR-99's upper
deck, its 4.3 m collision circle touching the bore wall, stopped dead with a
column queued behind it. The loss now scales with the angle: `glance =
clamp(-along / 0.3, 0, 1)`, `vLong *= 1 - 0.8 * glance`. Head-on (~17 deg or
more into it) keeps the full loss, a pure side contact keeps all its speed.

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

**One-way lanes span the carriageway, 4.2 m apart** (`LANE_W`), not 3.6.
`resolveCarCollisions` tests circles of radius 0.42 x length — 2 m for a
sedan — so two cars abreast at 3.6 m shove each other the whole way. Lanes stay
out of parking (2.2 m) and the shoulder (0.8 m) and inside the narrowest graded
`e.tw`. **An overlapping opposing carriageway owns its half**: SR-99's tubes were
14 m roads 7.5-11 m apart at one level, and laid across full width each tube's
left lane ran 1.3 m from the other's oncoming one, so a side is capped at the
midline to any near-parallel opposing edge within 3 m of height. Stacked 6.6 m
apart, SR-99 no longer trips it past the north mouths. Two-way streets are
unchanged, at 0.48 hw right of centre.

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

## The one height surface

The heightfield is now **imported** rather than baked from polygon distance
tests, but the law is unchanged and is still the one that bites:

> After boot, every consumer -- terrain mesh, road quads, buildings, cars,
> pedestrians -- reads the same `terrainHeight()`.

**It is not bilinear any more, and the importer never got the message.**
`terrainHeight()` interpolates the way the terrain MESH is triangulated, because
a bilinear query over a triangulated mesh disagrees by `(a + d - b - c) / 4` and
that is what grass growing through the road was. `tools/build_roads.py` still
bakes node heights with a bilinear sample, and its `terrain_at()` docstring
still claims *"Bilinear, matching geo.terrainHeight() exactly."* — which is now
false. Measured: **55,282 of 64,170 nodes (86 %) carried a wrong height, worst
by 6.63 m.**

Ground nodes therefore re-read their height from `terrainHeight()` at load, in
`cityGenerator`. Elevated nodes keep their baked value — that is a deck, not the
ground under it. Done at load rather than in the importer for the same reason
`roadFit()` is: the correction travels with the geometry and cannot go stale
against a re-import. `cityStats.nodesReheighted` / `worstReheight` report it.

Note this did **not** move `sink` (11.8 % -> 11.82 %): `meshRoad` draws strips
from `terrainHeight` directly and only uses node `y` for its bow/grade
subdivision heuristics. It is a correctness fix for the invariant above, not a
fix for anything visible, and shipping it as the latter would have been a lie.

`height.png` is 651x651 at 40 m (26 km / 40 m, +1). **That spacing is not free to change**: it is
also the terrain mesh's vertex spacing, and the two have to agree. A finer query
grid floats roads over bulges the mesh doesn't resolve; and at 20 m the mesh
would cost ~3.4 M triangles across the 26 km map, several times the whole frame budget.

Bridges and freeway decks are separate: `city.groundAt(x, z, currentY)` returns
the deck NEAREST `currentY` within `DECK_REACH` (0.9 m above it), else the
terrain. It used to take the *highest* deck within 2.6 m, which is taller than a
car -- see "Freeway grading" for the 3.76 m drop that caused. With no `currentY`
(a spawn or a placement query) it still takes the highest, which is the only
sane answer without a reference height.

**Ground-level freeway is a deck to `groundAt` too.** Every graded edge — deck
or ground freeway/ramp — registers one deck surface per ~5 m sample of its
profile, and `roadLift` answers only the embankment (batter) off it. So the
re-reheight above applies to draped roads only: **a graded node's `y` is the
road surface** (surface - 0.09, as decks always were), set by `gradeRoads`,
not the terrain under it.

**Paved surfaces sit above the terrain and everything standing on them has to be
lifted by the same amount.** `ROAD_LIFT` / `NODE_LIFT` / `WALK_LIFT` in
citygen.js are the single source of truth, shared with world.js.
`city.roadLift(x, z)` reports the lift at a point; `groundAt` takes it as an
optional 4th argument because vehicles sample the ground seven times a frame and
the edge scan is too expensive to repeat per wheel. Forgetting this is what
buried every car 22 cm into the asphalt.

**All three lifts have to be reachable from `roadLift`, not just the two the
strips use.** Junction squares are drawn at `NODE_LIFT` and they overlap the
ends of every strip that meets there, so `roadLift` asks `nodeLift` first and
takes its answer outright -- a point inside the square is standing on the square.
Maxing it against the strip scan instead gets both signs wrong: junction centres
came back `ROAD_LIFT` and sat 3 cm *inside* the asphalt, and the corners of the
square came back `WALK_LIFT` and floated 19 cm *above* it.

Sidewalks stop short of each junction (`nodeRadius`) and the corner is filled by
a ring drawn in `meshNode`. **That ring needs its own entry in the lift lookup
too.** It sits outside the junction square, and its diagonal corners are past the
end of every strip that meets the node, so the edge scan finds *nothing* there
and returns a lift of 0 -- which dropped anyone standing on a corner the full
44 cm through the pavement. `nodeSurface()` reports the ring as well as the
square, but the two are used differently: the square **overrides** the scan (it
is the top surface there), while the ring only fills in where the scan came back
empty, because along a road direction the strips overlap the ring and know better.

### Pavement verges

**A pavement is a flat slab and then a 1 m verge down to the ground.** It is
drawn flat to its outer edge at terrain + `WALK_LIFT` and comes down across
`VERGE` (1 m for 52 cm, ~27 deg; exported from citygen) in `world.meshVerge`,
for strips and junction rings alike. `roadLift` reports the same slope off a
strip, `nodeSurface` off a ring's band (by max(|lx|, |lz|)), so walking off the
pavement is a slope and not a fall. The verge's lip follows the slab's own edge
chord, so the two cannot part, and it is not drawn over a carriageway, into
water or into a cutting.

It used to be an open 52 cm step: a pedestrian on the grass beyond was correctly
on the ground and, seen across the slab from eye height, sunk to the waist.
**And the query disagreed with the drawing twice over.** `roadLift` tapered
the pavement to zero across the slab's last `RAMP` metres while the slab was
drawn flat to its edge -- a 26 cm sink over the outer half metre -- then stopped:
the 52 cm step. The taper also HID a second disagreement: a pavement lying over
ANOTHER road's carriageway reported `WALK_LIFT` there, 22 cm over the drawn
tarmac, although `meshRoad` drops that pavement piece. Neither pavement nor
verge lifts a point on another road's carriageway now (`onCw`, segment interior
only -- past an end the clamped distance is a round cap, which the junction
square answers for). **jank `sink` 295 -> 99.**

verify's tunnel-lift check had to learn the verge: its "is anything but a
tunnel covering this point" radius grew by `VERGE` (hw + 4.4 along an edge,
(hw + 4.2) x 1.45 round a node), or it counts every verge as a bore lifting
bare ground.

## Geometry building

`Builder` (build.js) accumulates positions/normals/uvs/colors and emits one
`BufferGeometry`. **`quad()` and `tri()` auto-correct winding against the supplied
normal** — this exists because hand-wound horizontal quads were backface-culled,
which made every road surface in the city invisible while the sidewalks (wound
the other way) rendered fine. Don't "optimise" that check away.

`mergeByMaterial()` flattens a group of static meshes into one mesh per material;
landmarks would otherwise cost hundreds of draw calls.

## Phone performance: the Mac stand-in

**The iPhone 17 Pro is CPU-bound, at roughly 12x an M2 Pro in this game.**
Its Debug readout (`cpu ms:` and `render ms:` lines) put traffic, peds and
render at ~12x what the same scene costs in headless Chrome on the Mac. The
GPU is not the limit: the Mac's whole frame is ~1.6 ms of GPU, the scene pass
costs the same scissored to one pixel, and quality tiers barely moved the
phone's fps. WebKit forwards every WebGL call to its GPU process, so draw
calls and GL calls are expensive there in a way Chrome hides.

- **Measure with `--throttle=8`** (perfcpu.mjs, rendercpu.mjs): CDP CPU
  throttling after boot. perfcpu waits for streaming to settle first, and has
  `drive-qa` (Queen Anne) and `foot-yt` (standing at Yesler Terrace) runs.
  **Trust the means, not the spikes**: the throttle suspends the thread in
  slices and charges the pause to whatever is running, so a 7 ms
  world.update on a frame that built nothing is an artifact. Judge stalls
  unthrottled, by the longest build step (`rendercpu --builds`).
- **Count draws and GL calls, which are device-independent**: the
  `cats.js`-style frustum breakdown and a wrapped-GL call counter found most
  of what mattered. v76 -> v80 took Yesler Terrace from 338 to 171 draws and
  ~1070 to ~700 GL calls a frame.
- **Watch for per-frame program lookups**: a transparent DoubleSide material
  renders in two passes and sets needsUpdate twice a frame; use
  `forceSinglePass`. Wrap `customProgramCacheKey` to catch any other.
- **Keep one hidden class** for anything iterated every frame (vehicles,
  pedestrians): declare every field in the constructor. `forward` is cached
  per heading; don't hold it across a heading change.
- Phone-only paths (all keyed on `ON_PHONE`): far traffic instanced
  (`FAR_LOD`), off-screen traffic past 80 m at half rate, pedestrian animation
  LOD and CPU culling, chunk JS arrays dropped after upload (a lost context
  rebuilds the chunks), 2 ms streaming slice while driving.

| 8x-throttled, mean frame CPU | v76 | v80 |
|---|---|---|
| Queen Anne drive | 10.5 ms, 207 draws | 4.7 ms, 107 draws |
| downtown drive | 12.0 ms | 5.5 ms |
| I-5 drive | 11.5 ms | 6.5 ms |
| standing at Yesler Terrace | 13.1 ms, 338 draws | 6.2 ms, 171 draws |

### Heat: don't redo work whose answer has not changed (v121)

The phone runs smoothly and hot. Two things were recomputed every frame
to the same result:

- **The menu and the map drew the city behind them.** Paused, the loop still
  rendered the scene, shadows and post chain 60 times a second under an 86 %
  overlay. Now it draws two frames after the menu shows or the map opens and
  then leaves the canvas alone until something asks (`idleRedraw`: a resize, a
  tap in the menu, quality, coming back from the background). The idle keys
  off the menu being SHOWN, not `game.paused`: harnesses pause without the
  menu to pose shots, and must keep drawing.
- **The city's shadows are drawn once** (`src/shadowcache.js`, phones only).
  Static casters (`world.group`, the landmarks, the ramps) render into a cache
  60 m bigger than the shadow box on every side; each frame it is copied into
  the live map shifted by whole texels -- `placeSun` snaps the box to the texel
  grid in all three axes, so the shift and the depth offset are exact -- and
  three's own pass draws only the movers over it (statics hidden, its clear
  suppressed). It re-renders when the box leaves it (the box rides 90 m ahead
  of the camera: every ~2 s driving, once after a look round), when a chunk
  within reach of it is built or dropped (`world.onChunkChange`, with 340 m for
  a tower's shadow at this sun), and when a range-culled landmark mesh toggles.
  It wraps `shadowMap.render`, so every `renderer.render` -- game and
  harnesses -- gets it; it refuses to install if its copy shader did not
  compile (three does not throw, it would draw no city shadows), and turns
  itself off on any error. `window.__noShadowCache` (perfcpu
  `--no-shadow-cache`) boots without it.

**`renderer.info` resets AFTER the shadow pass**, so `sceneStats`, perfguard
and the Debug readout have never counted shadow draws. perfcpu now reports
the pass separately (`shadow pass: N of M`, by caster kind).

| phone profile, shadow-pass draws | three's pass | cached |
|---|---|---|
| driving I-5 | 29.7 | 12 |
| driving downtown | 36 | 14 |
| standing downtown | 22 | 2-3 |

At the 8x throttle: render 5.06 -> 4.65 ms/frame driving downtown, 4.53 ->
4.05 standing; shadow pass 0.59 -> 0.27 ms. `node tools/shadowcheck.mjs`
reads the live shadow map back through the cache and through three's pass at
seven boxes (small shifts, past the margin, a turn) and compares the depths:
all but a few edge texels a caster just touches (float transforms of ~1 km
coordinates rasterise them differently) agree to ~1e-5. The cache is ~1350 px
square, RGBA plus depth, ~15 MB of GPU memory. Desktop keeps three's pass:
its 2048 map would make the cache ~4x that.

### Hitches: everything first-used belongs behind the loading screen

**Nothing was compiled until the first frame, and some things not until much
later.** A scripted session (on foot, car, police, gunfire, an explosion, a
boat, a climb past 45 m) logged four programs compiling mid-play, each a
frozen frame on the Mac stand-in: the no-UV shadow-depth variant (every
vehicle, the first car inside the shadow box) 468 ms, the far massing
355-482 ms, the far roads up to 175 ms, the boat wake 60-130 ms. And the
first frame after the reveal compiled the other ~36 while the overlay faded,
then `peds.update` built the 12 + 4 pedestrian look pools inside the same
frame (224-264 ms at 8x). main.js now, before hiding the loading screen:

- calls `warmLooks()` (peds.js), which builds both pools;
- draws **two** frames with stand-ins: ONE sedan's three parts casting at
  the player's feet (the programs are shared by every type), `world.warmMeshes()` (the far layers' materials on an
  empty draw range -- the layers themselves stay unallocated at street
  level), and the wake mesh shown for the two frames.

**Two frames, because three r160 runs the shadow pass before it sets up the
frame's lights**, and depth programs are keyed on the light counts: a
renderer's very first frame compiles them for zero lights and the next for
the real ones. One warm frame compiled the wrong copy.

**Never dispose a stand-in's material**: dispose releases its program when
nothing else uses it, and before the layer or the first car exists nothing
does -- the warm-up would compile programs only to throw them away.

**v98 broke the game on the iPhone while every Chrome harness passed.**
Unplayable, no movement; reverted in v99, and the pieces re-landed one build
at a time (v100 the query grids, v101 this). v98's warm-up uploaded EVERY
vehicle type's geometry (~20 types x 3 parts) for no measured gain; the
likely failure is WebKit's GPU process giving up under it, which no Chrome
run can show. So the warm-up stages one sedan only, runs in try/finally (the
stand-ins always come out and the loop always starts), and logs a lost
context. **Anything that front-loads GPU work ships in its own build, tested
on the phone before the next change lands on top of it.**

| 8x, cached launch | v97 | v101 |
|---|---|---|
| worst frame in the first 120 after the reveal | 557-693 ms | **81-141 ms** |
| first 120 frames | 2.21-2.48 s | **1.66-1.82 s** |
| programs compiled after the reveal (scripted session) | 4 | **0** |
| loading screen | 8.4-9.8 s | ~0.3-0.5 s longer |

Re-run the catalogue after adding a material that is created lazily: a
`renderBufferDirect` wrapper that records which object made
`renderer.info.programs` grow. `boottime.mjs` takes `BOOT_WAIT=<ms>` so a
`BOOT_INJECT` recorder can see the first frames of play before `BOOT_PROBE`.

### The ground queries' grids

`groundAt`'s deck-surface grid was 120 m cells. On I-5 a cell listed hundreds
of ~5 m graded pieces, and every call walked them all: 27 us a call on the
phone profile, 1.4 ms a frame driving the freeway. It is 20 m now, each piece
filed only in the cells its reach touches (`hw`, **plus the 4 m a bore holds
its car with**: the 120 m grid never padded for that, so a bore's catch
margin silently did not apply near a cell edge). `nodeSurface` (which
roadLift asks first) walked every node in up to four 150 m cells, because its
reach is sized by the widest road anywhere; each 16 m cell now caches, on
first use, the nodes whose junction bound can reach it, in the same order.

Proven exact by a hash of `groundAt` / `roadLift` over 284k queries (random
points, points along every graded, deck and tunnel edge and near every kind
of node, from five reference heights): the node cache changes nothing, the
20 m grid hashes the same as a 120 m grid with the same padding, and the only
difference from v97 is the bore margin now applying everywhere. SR-99 rides
unchanged (0 captures, 0 hops both ways), jank figures unchanged.

| unthrottled, per call | v97 | v98 |
|---|---|---|
| `roadLift` downtown / freeway | 1.69 / 2.08 us | 0.61 / 0.60 us |
| `groundAt` downtown / freeway | 2.13 / 6.46 us | 0.86 / 2.06 us |
| 8x, I-5 drive: `groundAt` per frame | 1.09-1.15 ms | 0.35-0.54 ms |
| 8x, I-5 drive: traffic system | 1.46-1.66 ms | 0.90-1.03 ms |

**Idle vehicles are distance-culled.** 'apron' vehicles (airfield aircraft,
dock boats, park quads) never despawn and were drawn at any range -- from
downtown six were in the frustum 1-10 km away. They show to 80 lengths
(about 10 px on a phone), never closer than a parked car: 8-10 fewer draws a
frame downtown (166 -> 157 driving, 159-163 -> 151 on foot).

## Boot time and the boot cache

**`tools/boottime.mjs [--throttle=8] [--twice] [--prof]`** times every loading
message on the phone profile, with the CPU throttled from before navigation.
`--twice` reloads in the same browser profile and times the second launch;
`BOOT_PROBE='<expr>'` evaluates after each launch (hash the city there to prove
a cached launch builds the same city as a computed one).

**`src/bootcache.js` keeps deterministic boot results in IndexedDB, keyed by
the build number** (`#build`), and main.js loads them all in parallel at the
start of the boot. What is kept, and where each is made and restored:

| key | made / restored by | ~size |
|---|---|---|
| `textures` | `planTextures` (right after buildTextures) + `encodeTextures` / `restoreTextures` -- PNGs, decoded with no colour or alpha conversion | PNG |
| `map` | the minimap canvas as a PNG (`canvasToBlob` / `blobToCanvas`) | PNG |
| `buildings` | citygen `packBuildings` / `unpackBuildings` -- the fitted list as Float64 columns | 17 MB |
| `grade` | citygen `gradeSnapshot` / `applyGrade` | |
| `portal` | world `_computePortalCuts` / `_applyPortalSnap` (used only with a cached grade) | 6 MB |
| `vehicles` | vehicles `vehicleSnapshot` / `setVehicleCache` (geometry; far LODs on a phone) | 19 MB |

Whatever a launch computed is written on the loading screen ("Remembering the
city"), and writing one build's entries deletes every other build's. **So the
build bump is also the cache invalidation**: a change to anything these
produce, shipped without a bump, would boot a stale city on any device that
launched the previous code under the same number. Every failure (private
mode, quota, a hung open, a bad PNG) falls back to computing, piece by piece.
Harnesses use fresh browser profiles, so they always take the computed path;
judge the cached path with `boottime.mjs --twice` and a `BOOT_PROBE` hash
(city, texture pixels, map pixels, vehicle geometry all matched in v85).

| 8x-throttled, first frame | v82 | v85 |
|---|---|---|
| first launch of a build | 31.3 s | ~22 s (incl. 1.6 s writing the cache) |
| later launches (cached) | 31.3 s | ~8 s |

## Draw-call budget

At `high`, perfguard's downtown reads roughly 165 steady draws and ~285 a
frame, ~1.18-1.19 M triangles a frame (the spread is how much traffic spawned
that boot, not the build). Steady draws fell from ~220 when the landmarks were
split into culled clusters (see "Landmarks"). Triangles are up on the
pre-import city because the building density is real; draw calls are not.
Flying adds 10-20 draws for the far massing layer and 6-9 for the far roads
(see "Flying").
`__dbg.sceneStats` reports the scene pass specifically — read `renderer.info`
yourself and you'll get the post chain's fullscreen quad instead, because the
counters reset on every `render()`.

Where the budget goes, and the rules that keep it there:

- chunk streaming: `CHUNK = 400`, `NEAR_R = 2` (full detail), `MID_R = 4` (roads
  only). Up to 6 merged meshes per near chunk: road, sidewalk, flat, glow, glass
  and **one for every other wall material**. Stone, brick, industrial, house and
  signage used to be five meshes and were 115 draws downtown for 25k triangles —
  216 triangles a draw, on a target where the draw calls are what bind. They
  share one atlased material now; see "One material for every wall" below.
- **vehicles are 3 draws each** — `paint` / `trim` / `matte`, sharing geometry
  and the two non-paint materials across every instance. Traffic uses the
  `…GeoW` variants with the wheels baked in; only the player's car calls
  `setDetailed(true)`, which swaps to the wheel-less geometry and adds four
  articulated wheel groups. Glass stays inside `trim`, so see-through cabins
  added no draw (see "Vehicle glass is see-through"). Traffic averages ~6,800
  triangles a vehicle (weighted by `CIVILIAN_TYPES`; the bus is +22 % on its
  pre-cabin 8.1k, planes ~1.5k). `import('./apps/auto/src/vehicles.js')` in
  Node and read `vehicleAssets().types[k]` index counts — no browser needed.
- **on a phone, vehicles past 60 m are instanced** (`traffic.updateFarLod`):
  one InstancedMesh per type over `farLod(type)`, the three part geometries
  merged and vertex-clustered at 20 cm (~35 % of the triangles), paint tinted
  per instance and masked per vertex (`lodA`). Instances are frustum-culled
  per car on the CPU, because an InstancedMesh culls as one object. Desktop
  (`FAR_LOD` Infinity) is unchanged, and nothing that casts a shadow
  (`SHADOW_NEAR` 45 m) is ever instanced. Judge it at telephoto against the
  full meshes in one frame: from 60 m they are near-identical.
- **landmarks are clusters**, merged by material within ~1.2 km and culled on
  their own bounds: 100 draws and 68k triangles for all of them, but only the
  clusters in view are paid for.
- **characters are 1 draw each.** They're `SkinnedMesh`es over a pool of 12
  shared geometries (`variants()`) plus 4 for cops (`copVariants()`), ~3.4k
  triangles each, so per-instance cost is a skeleton, not a buffer. **Never
  dispose a pooled geometry** — `makeHumanoid` returns a
  `dispose()` that no-ops unless the character was built `unique`, and
  `PedSystem.remove` must go through it. Disposing it directly yanks the GPU
  buffers out from under every other pedestrian wearing that look.
- every tall building in the whole city is one static "far skyline" mesh.
- **terrain is 12 x 12 tiles.** Tile size trades draw calls against wasted
  triangles, and on a phone the draw calls are what hurt. 20 x 20 put 132 terrain
  meshes on screen at once -- a third of the entire budget -- for ground that is
  mostly behind buildings; 8 x 8 makes each tile 3.3 km wide on the 26 km map and the
  frustum never culls one.
- parked cars only exist within `PARKED_RADIUS` and hide past 140 m. Lot
  parking adds at most 6 cars (+18 draws), only inside a lot.
- lots are drawn by the terrain shader: 0 draws, 0 triangles.

`roadLift()` is a 3×3-chunk edge scan, so **anything that samples the ground
more than once a frame computes the lift once and passes it in**: vehicles take
seven samples, the player two, pedestrians one. Calling `groundAt(x, z, y)`
without the 4th argument silently re-runs the scan.

## Sound

**Everything is synthesised; the repo ships no audio files.** `audio.js` has
three layers, each built for what it costs on the phone:

- **One-shots are rendered once.** `SOUNDS` holds recipes (crunch, glass,
  scrape loop, explosion, pistol, punch, footsteps on hard/grass/gravel/water,
  doors, seat, starter, kickstand, air brake, backfire, splash, slosh loop,
  squeal loop, gravel loop, pickup, cash, wanted sting, UI cues). `renderBank`
  builds them in ~3 s batches of OfflineAudioContexts, seeded so every launch
  gets the same bank (57 buffers, ~45 s mono, ~0.3 s on the Mac's GPU page),
  filling the bank IN PLACE in `BANK_FIRST` order: footsteps, doors and
  impacts are ready after the first small batch. Playing one is a
  BufferSource + gain (+ panner, + distance low-pass, + reverb send), capped
  at `MAX_SHOTS` 18.

**The context is created at boot and unlocked on the first ACCEPTED gesture.**
It used to be created, and resumed, on the first `pointerdown`, and the
listener then removed itself. A touch's pointerdown is not user activation
(only pointerup / touchend / click are, plus keydown and a mouse's
pointerdown), so on the iPhone walking with the stick created a context that
could never start: silence until some unrelated tap -- unpausing, the radio
button -- resumed it, and then every sound at once. Now `audio.init()` runs
before the reveal (a suspended context needs no gesture, and the bank renders
while you load), and wireUi listens on pointerup, touchend, click, keydown and
pointerdown in the CAPTURE phase (the on-screen buttons stop propagation),
removing itself only once `ctx.state === 'running'`. `audio.live` gates
`play()` and `update()`: anything scheduled on a suspended context piles up at
time 0 and fires all at once on the unlock. `tools/audiounlock.mjs` drives the
stick with real CDP touch events under the activation policy and prints the
state at each step (`--bench` times the bank; use `AUTO_GPU=1` -- on
SwiftShader each render batch waits for a ~0.5 s frame and the bank reads
20-40 s, which measures the harness).

**The radio is twelve stations** (v122, `STATIONS` in audio.js): KEXP, RdMix
Classic Rock, BBC Radio 1, Top 100 Charts, NRJ Linkin Park, Rock Antenne
Alternative, 80s Drive, C89.5, KNKX, Classical KING FM, and two synth-only
stations. Every live one keeps a synth voice for when it is offline or dead.
Getting into a car tunes a random one (never the last); RADIO on the driving
pad (the only on-screen radio control, and only in a car: v124 removed the
HUD's 📻), R or the pad's shoulder buttons tune the next;
the pause menu lists them all.

- **Find streams with the radio-browser.info search /apps/radio uses**, then
  check each with curl: HTTPS, an audio content type, and a CORS header for
  polkiewicz.com. An https page may not load an http stream. BBC Radio 1's HLS
  master playlist points at an http variant, so the station is that variant
  over https; Safari plays HLS in an `<audio>`, and a browser whose
  `canPlayType` says no skips the station (`playable`).
- **The element has no `crossOrigin`**: nothing reads its samples, and asking
  for CORS only lets a station fail.
- **A stream that neither plays nor errors is silence forever**, so 20 s in
  `loading` marks it failed and the synth voice covers. BBC Radio 1 takes
  ~13 s to start in desktop Chrome. A failure is forgotten on retuning.
- Only KEXP has a now-playing feed; the others put titles in the stream
  (ICY), which a media element hides.
- verify tunes every live station in a car and reports how long each takes to
  sound (reported, not failed: they are other people's servers), and fails if
  five cars in a row get the same station.

**Resume from anything but `running`, on every gesture, for the whole
session (v120).** iOS stops the context behind the page's back (the home
screen, a call, Siri) and reports it as `interrupted`, which Chrome never
does; `resume()` only acted on `suspended`, so on the iPhone the game went
silent and stayed silent. The unlock listeners never remove themselves (a
running context makes each one a state check), and `audio.init()` sets
`navigator.audioSession.type = 'playback'` so the ring/silent switch does not
mute the game (iOS 17+; the radio's media element never followed it, which is
why the radio could play while nothing else did). `tools/audiounlock.mjs`
fakes an `interrupted` context and taps again; master before this fails it.

**`primeLive` retries after `NotAllowedError`, and never touches an element
the real stream holds.** Letting it retry exposed a race verify's radio check
caught (3.8 s streamed -> 0.1 s): a late prime re-muted and paused a stream
already loading. It now returns if the stream is loading or playing, and a
token lets `startLive` supersede a priming play still in flight.

**Footsteps are a heel knock and a sole roll under ~1.5 kHz, at a quarter of
their old level.** They were a white-noise click at 2.2-3.6 kHz with an
instant attack (centroid 3-6 kHz), and the footsteps scene measured -28.6 dB
RMS against -33.4 for a car passing; now centroid 0.65-1.6 kHz and -35 dB,
with +/-15 % per-step gain and pitch variation.
- **Engines are a firing pattern, not an oscillator pitch.** The tone's
  PeriodicWave is the spectrum of one exhaust pulse per cylinder at its point
  in the cycle (`ENGINES[..].fire`), so the cross-plane V8's uneven banks and a
  V-twin's 315/405 split give their burble by construction. `EngineModel` is the
  machine (gears, clutch hold off the line, shift points by throttle, rev
  limiter, spool-up, lift-off crackle) and `EngineVoice` the 19-node graph it
  steers. **The profile is picked from spec flags by `selectEngine`** -- the
  comment above `ENGINES` lists them: `engine` (explicit), `heli`, `boat`,
  `plane` (+ `turboprop`/`jet`), `ev`, `moto` (+ `vtwin`), `atv`, `bus`/`cargo`/
  `diesel`, `police`/`v8`, then `hand`. A new vehicle type needs only a flag.
- **Positional voices are pooled**: 3 traffic engines (nearest cars in 70 m,
  kept on the car they have), 2 sirens (LFO on the carrier, so the sweep is
  smooth at any frame rate; wail far, yelp inside 45 m), the police helicopter
  (built on first sight). Pan, distance and doppler come from `spatial()`
  against the camera (`listener` in main.js).
- **Mix**: every bus into one DynamicsCompressor limiter, then the volume
  control. `duck()` pulls the synth radio down under crashes, gunshots and
  stings (the live stream too, except on iOS, which ignores `volume`). A
  convolver with a generated street IR takes sends from one-shots and, in a
  bore (`enclosed`), from the engine.

Rules that each cost a debugging round:

- **Idle voices are DISCONNECTED, not muted** -- a graph that does not reach
  the destination is not rendered. Only the voice objects (`Tap`, the
  `_link`/`on` flags) may connect or disconnect.
- **Drive a param through `setp()` only**, which skips unchanged targets
  (51 -> 16 automation calls a frame, ~0.07 ms of `update()` on the Mac). It
  caches the last target on the param, so a direct `.value` or
  `setTargetAtTime` on the same param desyncs it.
- **`tools/audiorender.mjs` is the only way to hear it headlessly.** It drives
  the real `Audio` class with an OfflineAudioContext (`init(ctx)`, `_simT`)
  and writes `docs/audio/` WAVs (every bank sound, an enter-drive-exit run for
  every engine profile, pass-bys, crashes over the radio, footsteps, horns,
  water, a tunnel), failing on clipping or silence. An offline render
  schedules the whole script BEFORE rendering and graph changes are not
  scheduled events, so previews keep every voice linked (`keepLinked`) and
  must use `setValueAtTime`, not `.value`, for anything that changes mid-run.
  The voice cap prunes by END TIME, not `onended`: offline, nothing has ended
  when the next shot is queued, and cutting the "oldest" silenced a whole file.

## Verifying

`node tools/verify.mjs [--shots]` with `python3 -m http.server 8000` running. It
boots the game headlessly, asserts landmark positions against real lat/lon, checks
graph and budget numbers, drives a car, and writes screenshots including two
aerials. `AUTO_PROBE='<expr>' node tools/verify.mjs` evaluates a one-off
diagnostic on the same proven boot path -- use that rather than writing a second
CDP harness, which is how the first one drifted.

It does two things you must keep doing by hand if you write your own: **bypass
the service worker** (`Network.setBypassServiceWorker`) or you will test a stale
build and chase phantom bugs, and set `window.__noAutoQuality = true` *before*
boot or SwiftShader's ~5 fps drops the tier and every screenshot lies.

`window.__dbg` exposes `{ game, city, player, world, traffic, peds, scene,
camera, renderer, controls, audio, pickups, G, THREE }`. Useful moves:

```js
__dbg.game.paused = true;                    // freeze and fly the camera
__dbg.player.enterVehicle(__dbg.traffic.nearestEnterable(x, z, 400));
__dbg.controls.btn.gas = true;               // drive
__dbg.game.addHeat(400);                     // summon the police
```

Note SwiftShader runs at ~5 fps, and `dt` is clamped to 0.06 s, so game time
advances far slower than wall-clock — measure displacement, not elapsed seconds.
Ten wall-clock seconds of walking is only a few metres; don't read that as stuck.

**To walk, send real keys** (`page.keyboard.down('w')`). Assigning
`__dbg.controls.stick.y` does nothing: `read()` opens with
`if (this._stickId === null && ...) this.releaseStick()`, the anti-latch guard
from the stuck-stick fix, so a stick set without a live pointer is zeroed on the
very next frame. This silently reads as "the player can't move."

**Every harness takes `AUTO_HTTP_PORT` and `AUTO_CDP_PORT`.** Serve master from a
second checkout on another port (`:8001`) and run the same harness against both
for a real before/after; several agents' Chromes can then share one machine.
Streaming timings (`updateP99`/`updateMax`) on a shared machine are contention —
run master as a control at the same time before believing either.

**`tools/perfguard.mjs` waits for the game loop to draw** (`sceneStats.calls > 0`
and pedestrians present) before measuring. It used to measure the moment
`__dbg` existed and compared an unrendered scene with no pedestrians against a
full one. A fresh worktree has no `tools/data/perfguard.json`, so save a record
from master before `--check`.

The purpose-built harnesses, each a fixed-dt, paused-game driver:

| tool | what it judges |
|---|---|
| `tools/gait.mjs [--trace]` | the stride against published bands, sole contact, the speed ramp (see "The gait") |
| `tools/walkcam.mjs <dir> [walk\|run\|sprint] [side\|chase\|both]` | the player walking on a real street at fixed dt through `player.update`, shot from the chase camera and a side camera every `WALK_STEP` frames. The moving body in context: where the crouched walk was obvious |
| `tools/gait-strip.mjs` | a frame strip of the cycle; forces the player's humanoid visible on the staging point (one boot spawned in a car and shot 12 frames of empty ground) |
| `tools/charshots.mjs [tag] [seed] lineup` | every pooled look plus a cop side by side at 9 m — a single seed says nothing about the pool. Close views `face`, `face34`, `profile`, `profilehead` (0.5-0.85 m, near plane 0.05: the game's 0.5 m cut the face in half), `hands`, `handback`, `grip`, `run`. The sun sits 300 m out: at 12.8 m the subject was inside the shadow camera's near plane and portraits could not show self-shadowing at all |
| `CHAR_VIEWS=a,b` / `CHAR_OPTS='{json}'` / `CHAR_EVAL='<js>'` | limit the views / merge into `makeHumanoid`'s options (a cop, the lightest skin, which no pooled look deals) / run an experiment on the posed subject first (switch off shadows, AO, map) |
| `CHAR_PROBE='face:x,y;x,y\|profile:x,y'` | raycasts pixels back to the part (`geometry.userData.parts`, recorded by `SkinAcc.add(..., name)`) and the BIND-pose point that drew them. The posed idle stands lower than bind, so don't compare posed y |
| `tools/crowdshots.mjs [tag]` | 12 pedestrians, one seed per POOLED LOOK, posed at dt = 0 on a real pavement; seeds `1000 + k*7919` landed on one look and photographed the harness. `CROWD_PROBE=1` prints each person's screen position, placed height, terrain, `roadLift` and what a ray straight down hits — a sunk figure is a disagreement between the ground query and the geometry |
| `tools/vehshots.mjs <tag> [types] [--street]` | `--street` parks a fixed lineup on the densest commercial street, shot at eye height and raised — a before/after random traffic can't give. The lineup spawns occupied, with a `chase` view on the first near-lane car |
| `tools/landmarkshots.mjs <dir> [views] [--collide]` | world-framed landmark views, per-landmark cost built alone, and the collision drive/walk (see "Landmarks"); `LM_PROBE` |
| `tools/lotshots.mjs <dir> [--probe]` | lot views; `--probe` prints the grass share per region (see "Lots, plazas and yards") |
| `tools/bldshots.mjs <dir> [--scan] [--shots=a,b] [--n=6] [--from=index.json]` + `tools/bldsheet.py <dir> [out] [--pair=<dir>]` | the building outlier scan and per-category contact sheets, eye level off the long (downhill) face plus an aerial; `--from` re-shoots another run's buildings by position for a before/after (see "Buildings: the outlier scan"). GPU by default (`AUTO_GPU=0` for SwiftShader) |
| `tools/stuntjumps.mjs [ids] [--caps] [--shots DIR]` | every stunt jump: corridor check, then the player's car driven off it at fixed dt per speed cap (see "Stunt jumps") |
| `tools/trafficcheck.mjs [--dump FILE] [--shot DIR] [--sites a,b]` | share of cars against the flow, oncoming contacts, stuck cars and jams over 7 sites at fixed dt, the last a police pursuit (see "One-way traffic") |
| `tools/flycam.mjs [--jitter]` | a scripted flight: camera measured RELATIVE TO THE PLANE and the plane's on-screen motion, since absolute camera movement at 116 m/s is ~2 m a frame regardless. The autopilot holds 45 m over the terrain under AND 400 m ahead, or the bay dive flies into Queen Anne. Also counts building and road pop-ins, and flies `i5high` (see "flycam: road pop-ins") |
| `tools/camtunnel.mjs` | camera height at stations through bores — nothing through the roof |
| `tools/aircraftshots.mjs [dir] [types] [--stage] [--field] [--flight] [--takeoff]` | aircraft on a plain stage (incl. a `close` cockpit view), on their Boeing Field spots, the helicopter flown through spool/lift/hover/yaw/forward/turn/stop/land under the game's chase camera, and fixed-wing take-off numbers (see "The hangar"). `AIR_PROBE='view:x,y'` raycasts stage pixels |
| `tools/jank.mjs` | `fwy-bump`, `crossing-clash`, `barrier-on-road` added for the grading (see "Freeway grading") |
| `tools/junctions.mjs [tag] [--only=cat] [--noshots]` | 19 junctions picked by kind; per junction a raycast classification map, hole / stacked tarmac / crossing paint / kerb gap / sink counts, and oblique, top and eye shots (GPU by default; `JUNC_PROBE='<expr>'`, `JUNC_AT=x,z`). See "Junctions, dead ends, bridges" |
| `tools/shadowcheck.mjs` | the phone's shadow cache against three's own pass: live shadow map read back both ways at seven boxes, depths compared texel by texel, draws counted (see "Heat") |
| `tools/audiorender.mjs [--only a,b]` | renders the sound offline to `docs/audio/*.wav`: peak/RMS/centroid/silence per file, fails on clipping (see "Sound") |

**A walker needs a seed, and the seed is the edge's own surface.** Seeded with
no reference height, `groundAt` takes the highest deck, so every freeway edge
starting under an overpass began on it and "jolted" off; seeded at terrain under
a 3 m fill it climbed the batter a step at a time (786 of 1356 jolts).
`fwy-bump` seeds from `e.ph[0]`, deck y or terrain; `barrier-on-road` seeds each
sample on its lane's own cambered surface and samples only inside a trimmed
lane's drawn extent — a terrain + 0.3 seed first read 24.3 %, counting the
road's own raised tarmac. verify's deck walks learned the same: compare against
the DRAWN deck, not the chord between node heights, and seed where the walk
starts. `beauty.mjs` hides `#topBtns`, and a view picker that finds nothing must
still return a posed camera (an un-posed fallback gave a NaN camera and a black
frame).

## Offline

`sw.js` follows the repo contract (see the `ruin` app): shell-only fast install,
lazy cache-first for the version-stamped Three.js build with copy-forward across
cache bumps, and URL-based `cache: 'no-cache'` revalidation (WebKit refuses to
`fetch()` a navigation-mode Request). **Bump `CACHE` in sw.js on any deploy that
must invalidate immediately.** Never add `vendor/` or `src/` to `SHELL`: a slow
install is what pins iOS players to a stale worker forever.

**Look up only the current version's cache** (`fromCurrent` in sw.js), never
`caches.match()`: that searches every cache, oldest first, and iOS can kill a
worker before activate deletes the old ones -- v86 on an iPhone loaded a new
`world.js` against an old `util.js` and died with *Importing binding name
'segDist' is not found*. The boot log in index.html reloads once, by itself,
when it sees that kind of error (files from two versions), after the new
worker takes over.

## Pull requests

**Every auto PR title carries the version it ships**, e.g. "Auto v57: ...".
The version is the one fact a bug report always needs and the one thing a
merge list otherwise hides -- and this repo has already shipped two releases
whose version bumps silently did not happen (a sed with no match exits 0).
The title makes a missing bump visible at review time.

## Build number

**`#build` on the launch screen and `CACHE` in sw.js go up together, once per
change** — `v9` next to `auto-v9`. The point is that a player can read the
number off the loading screen and say which build they are on, which is the
first thing worth knowing when a fix appears to be missing: a stale service
worker looks exactly like a fix that didn't work.

They stay two literals on purpose. Sharing one constant means either the page
fetching the number out of sw.js, or sw.js pulling it in with `importScripts` —
and in that second case sw.js's own bytes never change, so the browser has no
reason to install the new worker and the cache never turns over. **The byte
change to sw.js is the update trigger**, so that file has to carry its own
literal. Bump both, and keep the digits equal so a mismatch is obvious on sight.

## Vehicle asset table is `assets`, never `t`

`Vehicle.assets` holds the shared geometry for a type. It used to be
`this.t`, and `traffic.js` spawning a car did `v.t = t` with the car's position
along its edge — replacing the whole geometry table with a number. Nothing
noticed, because the meshes were already built in the constructor and
`this.t.wheelR` fell through to a default. It only surfaced when you got in:
`setDetailed(true)` iterates `assets.wheels`, so **carjacking any moving traffic
car threw**, and it threw *after* `this.vehicle = v` but *before*
`this.onFoot = false`, leaving the player half in the car. The HUD read the
car's speed while the sim still ran the player on foot, which is what "frozen
but the speedo works" was.

Parked cars were fine, which is what made it look intermittent — they spawn
through a different path that never wrote the field.

Two things follow. Don't give a shared, long-lived reference a one-letter name.
And when a bug report says a system half-works, suspect an exception midway
through a setup function rather than a stuck value: `requestAnimationFrame` is
re-armed at the top of the frame, so a throw part-way through leaves the loop
running with an object in a state no code path expects.

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
  `resetFarMass()` and the lazy builder makes them again. main.js has no
  context-loss handling of its own.
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

## Water, and the law that keeps being learned one caller at a time

**Every height test is against the LOCAL water surface**, because Green Lake is
at 50.3 m and Lake Union at 5. `world.waterLevelAt()` exists for this. The
on-foot path learned it; `updateDrive` did not, and its test was
`v.y < -1.2 && G.isWater(...)`, which only ever describes the sea. So a car on a
lake bed never tripped anything and **you could drive the bottom of Green Lake
at 200 km/h, dry and at full throttle**. Driving now samples the local surface
before the step, cuts the engine, drags the car down and sinks it. Verified at
Green Lake (surface 50.3, bed 43.4) and in Elliott Bay (surface 0, bed -5.4):
200 km/h -> 0 in both.

The lesson is not about water. **When a law is added, grep for every caller of
the thing it replaces** -- this one sat one function away from the code that
documented it, for as long as the game has had lakes.

### Every water-level test, again: the cuttings' water mask

The depth-only mask that keeps water out of a dug cutting (`portalCuts`,
`tunnelWaterMask`) was sea-level only. It stood at 0.02 m and covered floors
under ~1 m. The 520's cutting at the Montlake lid's east portal lies inside
Lake Washington's box with its floor at ~4 m, so the lake's 5.09 m plane lay
across both carriageways. Each mask quad now stands at `G.drawnWaterLevel()`
(the highest plane drawn at that point: the sea, any lake box, the canal), and
the "is this low enough to need one" tests use the same level.

**verify walks every road against the water drawn over it** ("roads under
the water"). It computes the drawn level itself and counts a sample only
when nothing hides the water there: not the cuttings' mask, not ground over
it, not a lid or deck overhead. The 520 and I-90 corridors must be dry, and
each floating bridge must be found and clear the lake by 3 m. Master before
this fix failed with 14 samples on the 520 and Evergreen Point at 0.61 m.
Everything else is held at its count (see "Known gaps"), so nothing new goes
under. **verify also used to end with `process.exitCode = bad.length ? 1 : 0`**,
which cleared every FAIL above it whenever the console was clean. Only ever
set a failure.

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

### Marinas, seaplane bases and the jet ski

**Ten docks round the region** (`landmarks.js` `MARINAS`, v112): Renton's
seaplane base on Lake Washington's south shore and Seattle Seaplanes on Lake
Union's east shore (floatplanes), and boats and jet skis at Shilshole,
Elliott Bay, Bell Harbor, Leschi, Carillon Point, Kirkland, Meydenbauer Bay
and Luther Burbank. Each is laid out from its real site by `marinaDock()`:
a pier off the bank, a gangway, a floating walkway (a T-head only at the
seaplane bases), piles, curbs as solids, and every top a platform. Its
moorings spawn in main.js as 'apron' (skipped past 300 m), and each is a map
place that says hello.

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

Walked from 12 m inland out onto every float (groundAt from the ground):
worst step 0.53 m, the kerb up onto the pier. Every moored boat and jet ski
drives off at full throttle without a shore contact.

**The jet ski** (`jetski` in TYPES, `buildJetski`) is `boat: true` -- the
boat's float, shore and lock rules, wake and exit -- on a 3.2 m hull with the
quad's posed rider (`RIDERS.jetski`, shown only when ridden), 105 km/h, and
in `updateBoat` 1.75x the yaw and three times the lean: 61 deg/s through a
full-lock turn at speed, leaning 19 deg. Not in traffic. **Re-shoot vehicle
geometry with a bumped build** or cleared `/tmp/auto-*` profiles: the boot
cache keeps vehicle geometry per build, and a harness profile that survived
showed the old hull.

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

In SR-99's portal groups only (`streetRoof`: groups holding the stacked
decks' nodes; citywide the rule would reshape 48 cuts whose lids were each
tuned against a regression -- judge those portal by portal first):

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
  way, the one at the far end leaves at once. You spawn ~310 m from Seattle
  Center, so the Blue train is there when you walk over.
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

## Fishing off the piers (an Easter egg)

**A rod stands at the far end of four real piers and floats** -- Pier 66,
the Aquarium's Pier 59, Elliott Bay Marina, Leschi Marina (`FISHING_SITES` in
main.js, v126). Each is snapped at boot to the outermost walkable point of the
deck nearest it with open water past its edge (`fishingSpots`: a 2 m grid of
`platformAt` points, scored by `shoreDist`); a rod on a stand, a bucket and a
tackle box stand there (`fishingProp`), and the map marks it. ENTER on foot
goes to `game.tryInteract` before the cars.

- **The cast is in the city** (`Fishing.start`, `_castStep`, the game paused):
  the character turns to the water, a rod in the right hand bone, arm back
  and a snap forward, the line flying to a splash ring 14 m out, the camera
  beside and behind.
- **Then a Game Boy Color fishing game** (`src/fishing.js`), after Funky's
  Fishing in Donkey Kong Country (GBC, 2000): 160 x 144 in a GBC shell,
  four-colour sprites drawn from strings, a 3x5 pixel font, a chiptune loop
  and blips on the game's AudioContext. Move the hook up and down (drag, W/S,
  arrows); the line holds four; A reels them in and banks them. Herring 50,
  perch 100, rockfish 150, salmon 300, dogfish 400, Dungeness crab on the
  bottom 250, a Giant Pacific Octopus buys 6 s. Two or more of one kind on a
  line buys time (4 s per extra) and three or more multiplies the points;
  junk (can, bottle, boot, tyre, from level 2) costs 5 s each. Levels by score
  multiply points and speed things up. Time-up pays score / 20 in dollars;
  best kept in localStorage `auto-fish-best`.
- While its screen is up the city is not drawn (the menu idle, see "Heat").

verify's "fishing" section: every site found its deck, ENTER casts and opens
it, banking / combo time / junk / hooking / payout all to the number, and
closing it unpauses the city. `docs/fishing/` has shots.

## Basketball in the parks

**A half court in four parks** -- Cal Anderson, Judkins, Green Lake, Jefferson
(`HOOP_SITES` in src/hoops.js, v127). Each stands on the flattest open ground
within 150 m of the site (park or lot, off roads, buildings and water, under
0.6 m of fall across it; 8 headings tried). The search costs ~30 ms a site on
the Mac, so its answer is stored with the site (`at`) and boot only re-checks
it (0.1 ms for all four), searching again if the city under it changed. A
court is a slab at the
highest corner with concrete skirts down to the ground, registered as a city
platform (so you stand on what is drawn) and kept clear of trees
(`city.clearCircles`). Regulation size: 50 x 47 ft, the key 16 ft, the board
4 ft inside the baseline, the rim 10 ft up and 18 in across, the free throw
line 15 ft out, lines painted into one canvas texture. The courts show within
450 m; the map marks them.

- **ENTER on the free throw line** (after the fishing rods in
  `game.tryInteract`) pauses the city and starts ten free throws. Tap once to
  stop the AIM marker, once more to stop POWER; the shot is the launch speed
  that drops a 56 deg arc 2.5 cm past the rim's centre, off by the markers'
  error (linear plus a cubic, so the green zone keeps the ball in the few cm a
  24 cm ball has through a 46 cm rim, and a marker stopped at its end
  airballs).
- **Nothing is decided in advance**: the flight is integrated at 6 substeps a
  frame against the rim as a torus and the backboard as a plane, so swishes,
  rattle-ins, bank shots, rim-outs and airballs all come out of the
  collisions. Measured over a 9 x 9 grid of marker errors: the green zone
  swishes or drops, the outer third rims out, the ends airball.
- A make pays $10, a swish $15, doubled from the third in a row; the markers
  speed up on a streak. Best score in localStorage `auto-hoops-best`. The
  driving HUD hides and the camera narrows to 44 deg while it is up.

verify's "basketball" section: every park found a court, you stand on it,
ENTER starts it, green-zone shots go in and wild ones do not, ten shots end
and pay, closing gives the city back. `docs/hoops/` has shots.

## Up the Space Needle

**The Needle can be ridden, walked round and looked out from** (v128,
`src/needletop.js`). ENTER on foot within 7.5 m of the core (the map marks
it, and it says hello within 55 m) rides the glass elevator on the core face
between the first two leg pairs (`ELEVATOR_A` in needle.js) to the top in
15 s (41 s in life), eased at both ends, while the city runs on. The camera
stands at the car's open front looking out between the legs with a slow
glance each way, and the car's display counts the feet to 520. The view goes
dark through the SkyLine level's floor (100 ft), which the car passes
through. Skip, ENTER or Esc ends it early.

- **The deck is the landmark's own geometry made walkable**: `needleDecks()`
  (24 flat segments of the ring between the indoor glass, r 13.85, and the
  barriers' foot, r 16.25, at 158.47 m) go in as landmark decks, which now
  take a `rot`, and `needleSolids()` adds one box per barrier panel and per
  indoor glass bay, banded to the deck. Walked into both and round:
  r 14.2-16.0, never off the floor.
- **The car is live**: the model no longer bakes a cab on that elevator's
  rails, and `needletop.js` draws its own (1 draw; open front, rail, header,
  the display) where the last ride left it.
- **Six coin-op viewers** stand at the rail, with the elevator door in the
  indoor level's glass (one merged mesh, `world.mats.flat`, 1 draw). ENTER at
  one looks through it: two lens fields (an SVG mask, the union of two
  blurred ellipses), drag or the stick to pan (+-83 deg, slower zoomed in),
  + / - / the wheel / Q, Z to zoom 1.5x-16x. The eyepiece names a landmark
  within a sliver of the view's bearing and at an elevation between its foot
  and 120 m up it, else the neighbourhood the view's ray meets the ground in
  (`G.placeNameAt`), with the distance and compass bearing. The stands hide
  while you look (you are looking through one), and the FOV is restored on
  leaving.
- **On the deck the far layers come on but the near ring stays detailed**:
  main.js reports 50 m of altitude to the streamer there (over 45 turns on
  the far massing and roads; over 100 would drop the near ring to massing),
  and the on-foot boom is 2.6 m (`player.camShort`), the deck being 2.4 m
  wide.
- Neither new mesh casts a shadow: from 158 m it would land far out on the
  ground, and on a phone anything outside the shadow cache's statics is
  drawn into the shadow pass every frame.

verify's "Space Needle" section rides up, stands on the deck, walks into the
barriers, the glass and round, zooms a viewer and rides down to the plaza.
`docs/needle/` has shots.

## The Tech Tour

Twelve badges at the region's tech offices (`activities.js` `TECH`, v114):
Amazon (Day 1 / the Spheres), Google (South Lake Union, Kirkland), Meta,
Adobe and Tableau, Zillow, Expedia, Starbucks, Microsoft and Valve in
Bellevue, and T-Mobile in Factoria. A spinning cube in the company colour
under a light column, shown within 400 m; walk or drive through it for
$1000, all twelve for a $10,000 bonus. Found ones persist as `__tech` in the
activities save; the pause menu counts them and both maps mark the rest.

- **Positions come from OSM where the extract names the building** (marked
  in `TECH`), else the street address through `tools/proj.py`. Addresses
  alone were not good enough: Expedia's came out 700 m off in Elliott Bay.
  Microsoft's, Nintendo's and Meta's main campuses are in Redmond, east of
  the map, so Microsoft is at its Bellevue offices.
- **Snap to the nearest ground-level street node**, searching the nodes
  directly: `nearestNode` can answer a deck (Aurora over Fremont), and
  returns **-1, not null**, when nothing is in range (the landmark coins had
  the same latent bug).

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

## Known gaps

- **Roads still under the water drawn over them: 50 deck/freeway samples and
  313 street samples** (verify's ceilings). Two causes. (1) A lake's plane
  covers its whole bounding box, and Lake Washington's is 25 km tall: dry
  ground below 5.09 m inside it floods, so Tukwila's Duwamish valley (South
  102nd/104th, East Marginal Way, the river bridges) and bits of Bellevue's and
  Kirkland's shore are under a lake 4 km away. The fix is to mask each lake's
  plane to its own water, as the canal's already is. (2) A short deck whose end
  node sits on a shore the raster dug as bed follows the bed down: the East
  Duwamish Waterway Bridge's end, Harbor Island's ramps, the Colman, Fauntleroy
  and Southworth ferry docks. A floor in `gradeRoads` does not reach these:
  their ends are anchors pinned to draped streets on the same dug ground, so
  the ground itself has to come up. Point Monroe (Bainbridge) is a spit the
  DEM has below sea level.
- **The monorail's doors do not open, nobody rides with you, and the terminal
  interiors are not walkable** beyond Seattle Center's platforms and ramp.
- **No Kenmore Air Harbor.** The real floatplane base at the north end of Lake
  Washington (47.756 N) is ~3.1 km past the map's north edge (47.728 N).

- **Freeway over freeway at interchanges stays as imported.** 110 of the 154
  refused overpasses; see "Don't dip a graded freeway under a ramp". They are
  most of what `barrier-on-road` still finds (another carriageway's tarmac
  over a lane), with 15-26 deg overlaps the split-level pass does not treat.
- **The contract probe still finds ~1 % of graded samples 10 cm+ off the drawn
  deck** at the densest interchanges (18 of 1655 at I-5 downtown, 24 of 3417 at
  I-5 / I-90). Mostly decks stacked ~1.1 m over another deck, left as imported
  (the probe's ray from y + 1.2 hits the deck above the car), plus a few
  junction-square and anchor cases at locked decks. See "What you drive on is
  what is drawn".
- **`survey.mjs` poses its eye-level camera from the node-height chord + 1.9 m**,
  which on a graded deck is not where the road is, so eye-level deck shots
  float. Kept so before and after share framing.
- **SR-99 is not to scale.** The NB deck runs 6.6 m under the SB one and bottoms
  at -17.6 m under SODO; the real bore is far deeper (64 m under Virginia St).
  The game box is 14 m wide (OSM hw 7) against a real 9.8 m roadway, and it is a
  box section, not the circular bore.
- **I-5 Express ramp cuttings slice its bore**: portalcheck's 4 sliced-bore
  samples are all the Express, at (569,-184)/(577,-212) and (513,77)/(514,66).
  Pre-existing; the old plan-only `inCut` hid them. **It stays because it is a
  profile problem, not a trench-floor one**: at (513,77) the ramp cutting's OWN
  ROAD runs 0.3-1.2 m inside the Express roof (ramp deck ~5.7 m over the
  Express deck, bore box 5.7 m), so no floor clamp can clear it. Clamping the
  trench floor onto the bore roof was tried and reverted: it fixed one sample,
  moved the slice to (514,66), and put ground 0.5 m over four corridors'
  carriageways (portalcheck). The fix is to drop the Express or lift the ramp
  there; (569,-184)/(577,-212) are the same class. The bore-joint fix did remove
  the dotted seams visible in the Express at that spot.
- **Wrong-way SR-99 rides pass only because the harness dodges** and keeps the
  car alive; cars collide as 4 m circles, so any head-on in a 2-lane bore is a
  hit.
- **meshPortalWall's "FACE THE APPROACH RAMP TOO" loop is dead code.** It reads
  `this._pcutBy.get(m.ni).apron`, but `_pcutBy` maps a node to an ARRAY of cuts
  since "one cut per branch", so `.apron` is always undefined and the loop has
  drawn nothing since. Found during the lid work and not fixed: iterating the
  array would bring back walls nobody has looked at since, so shoot the
  approaches before and after rather than just reviving it.
- **The express lanes only run northbound**, because the import drops
  `oneway=reversible` (see "One-way traffic").
- **AI lanes are 4.2 m apart** because the car collision shape is a circle, so a
  3-lane carriageway runs 2 AI lanes. The real fix is an oriented box in
  `resolveCarCollisions`.
- **Obstacles in dug pits wedge traffic** (posts beside lidded ramps, the I-5
  express portal near (520, 0)). Out of sight the car is recycled; in view it
  stays stuck.
- **Far roads still pop in during take-off, and double up on bends.** All 34
  of flycam's remaining road pop-ins (48 km) happen before the far layer's gate
  opens at 45 m. And an edge's end pieces reach over their node to cover a
  junction's square and a bend's outside corner, so at a bend two edges'
  pieces overlap on the inside.
- `tunnelride.mjs`'s `flow()` checks `oneway` before `onewayRev`, so it treats
  the 2 `oneway=-1` edges as a -> b. None is on SR-99.
- **Only three pier decks are walkable** (v106): the Great Wheel, Pier 66
  and the Aquarium list their tops in `userData.decks` (group-local boxes),
  and `buildLandmarks` installs them as platforms. The 40 m DEM leaves water
  or a 1.1-1.6 m step between the Wheel's and Pier 66's decks and the
  promenade, so a deck can name a `land` exit: `gangway()` walks the terrain
  out to the first dry ground within 0.9 m of the deck top and lays a sloped
  boardwalk (piles, rails) registered as one sloped platform. Walked vs drawn:
  0 cm. The ferry terminal, the other piers and the Alki pier have no deck.
- **Stadium interiors are unreachable** — walls run round the whole footprint,
  with no gates. T-Mobile's roof is modelled open and does not move.
- **The minor landmarks are the old models** (aquarium, ferry terminal, Pier 66,
  library, convention centre, locks, Kerry Park): physically shaded and solid
  now, but not rebuilt. Gas Works and the Alki statue were rebuilt in v118.
- **Park paths are not drawn.** OSM maps every trail (Discovery Park's Loop
  Trail, Green Lake's path), but the lot layer's 14.4 m coverage field
  cannot hold a 2 m path, and ribbons need the road mesher's terrain
  subdivision. Pitches are lawn with no markings.
- **The Pioneer Square pergola's orientation is est.** (no OSM footprint): its
  long axis runs north-south.
- **Lot edges come from a 14.4 m coverage field**: corners round off at ~7 m and
  a lot under ~10 m wide (one aisle, a narrow forecourt) thins or vanishes.
  Striping ignores the aisles OSM draws and is phase-anchored in world space, so
  a first row can start mid-bay at its kerb. Untagged Belltown/SLU blocks
  (no landuse, `building=yes` under 1000 m2) still read as lawn, and aprons are
  an inference: a big church or apartment block gets a concrete ring.
- **Buildings are oriented boxes**, not polygons — see "How accurate it actually
  is" for why that was the right trade, but it does mean a curved facade or an
  L-shaped block is squared off.
- **997 buildings (0.8 %) stand over water.** Most are real: Lake Union's
  houseboats, the Alaskan Way piers, Harbor Island. Not worth a filter that would
  also delete the real ones.
