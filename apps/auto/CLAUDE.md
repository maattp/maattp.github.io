# Auto

An open-world driving/on-foot game set in a ~16 km x 16 km Seattle, built from
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
src/landmarks.js            hand-built landmark meshes
src/vehicles.js             vehicle models + the arcade driving model
src/traffic.js              traffic AI, parked cars, police, helicopter, A*
src/peds.js                 humanoid builder + pedestrian/cop crowd
src/player.js               on-foot/driving state machine + chase camera
src/controls.js             touch stick/buttons + keyboard fallback
src/hud.js                  minimap, full map, readouts
src/effects.js              particles + tracers
src/audio.js                synthesised engine, siren, SFX, procedural radio
src/main.js                 boot sequence, game rules, frame loop

tools/proj.py               THE projection. Mirrored by geo.js -- change both.
tools/osm_extract.py        .osm.pbf -> projected raw_*.json  (slow, rare)
tools/build_raster.py       DEM tiles + water polygons -> height/surface/water
tools/build_roads.py        OSM ways -> roads.bin, and the graph assertions
tools/build_buildings.py    OSM footprints -> buildings.bin
tools/build_places.py       landmarks, neighbourhood names, spawn points
tools/fetch_dem.py          downloads the USGS terrain tiles
tools/render_map.py         draws the whole graph top-down, for eyeballing
tools/verify.mjs            headless CDP boot + assertions + screenshots
tools/jank.mjs, perfguard.mjs, beauty.mjs, survey.mjs, gait.mjs, flycam.mjs,
  crowdshots.mjs, charshots.mjs, vehshots.mjs ...   see "Verifying"
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
apps/auto/data/height.png     401x401 @ 40 m   h = ((R<<8)|G)/10 - 100
apps/auto/data/surface.png   1601x1601 @ 10 m  R = water, G = green
apps/auto/data/roads.bin      64k nodes, 70k edges          1.95 MB
apps/auto/data/buildings.bin  125k oriented boxes, chunked  1.51 MB
apps/auto/data/places.json    19 landmarks, 84 neighbourhoods
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
```

`build_roads.py` reads `height.png`, so **the raster step has to run first** or
every road node gets its height from the previous terrain.

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
still drawn at ground level, may never suppress the street above it.

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
scattered on the ground needs the same call.

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
looks.** `roadLift` ramps a strip's lift to zero across the last `RAMP` metres,
so a point under the ring can pick up a small tail — 0.06 m — and the ring's
0.52 m used to be discarded, leaving you 0.46 m inside visible pavement. Taking
the ring wherever it is higher is the obvious fix and it is **wrong**:
`nodeSurface` reports the ring as a plain box, but `meshNode` cuts the ring up
and drops the pieces covering each approach, so over an approach the ring is
reported and not drawn. Measured, that override moved `sink` 11.8 % -> 12.44 %.
Fixing it properly means teaching `nodeSurface` the approach-dropping that
`meshNode` does.

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
- **SSAO is built and switched OFF** (`fx.ssao: false`), because measured it
  still dirties the street. It reads the scene pass's own depth attachment
  (`postfx.sceneRT` carries an integer `DepthTexture`, filled for free), runs
  half res, and multiplies BEFORE bloom. But beauty shots with it on
  (`AUTO_SSAO=1`), lower-half median linear luminance:

  | shot | AO off | AO on |
  |---|---|---|
  | street | 0.156 | **0.076** |
  | shopfront | 0.172 | **0.090** |
  | facade | 0.109 | **0.061** |
  | park / skyline | 0.193 / 0.159 | 0.187 / 0.159 |

  It halves street-level values and lays dark clouds over open tarmac at a
  grazing angle, for 3 fullscreen passes. **Before turning it on, the occlusion
  test has to reject by surface orientation first.**
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
  (see "Flying") stands in for every building the rings have not delivered —
  a supertile layer, not wider rings.

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
  metallic) and `matte` (tyres/plastic/arches). See "Every vehicle type has an
  authored builder" below.
- **Characters** (`peds.js`) are `SkinnedMesh`es: one draw call each, but with an
  18-bone skeleton, so elbows and knees actually bend. Geometry comes from a
  pool of 12 designed looks plus 4 cop looks (per-instance variety is skeleton,
  scale, colours and gait), textured from one atlas, and `animateWalk` is a
  procedural cycle — counter-rotating chest, level head, breathing idle, and the
  legs described below.

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

### Characters: atlas, hair, looks

- **One 1024x1024 atlas** (`drawAtlas`, drawn at boot), one material, still one
  draw a character. Cells 0-4 are a painted face per skin tone, on WHITE head
  vertices so the paint shows (skin encoded to match the neck, because vertex
  colours are linear and the map is sRGB). Cells 5-11 are greyscale detail that
  MULTIPLIES the vertex colour: knit, twill jacket, denim, leather shoe, hair,
  hand, skin. Multiplied paint can only darken, so anything that must be the
  brightest thing on a garment (hi-vis bands) is geometry.
- Parts map cylindrically round their own axis; `SkinAcc.add` repairs the back
  seam per triangle or every feature smears down the back. The face cell wraps
  +-112 deg of the head only (~140 px across the face).
- **Features are paint, not geometry.** 3-6 mm eye/brow/mouth boxes read as
  stuck-on plates up close and, thinner than a depth texel, shimmered from
  across the street. Same for thin torso boxes (a placket): paint them.
- **Hair GROWS from the skull** (`buildHair`, with `SKULL` / `skullAt` shared
  with the head loft). Lofted shells with open bottom rings came out a bowl
  however the rings were treated. Each column starts on the skull at its own
  edge height (hairline, temple corner, sideburn, over the ear, nape) and
  thickens over its first 2 cm. **Start the shell 1 mm OUTSIDE the skull**: the
  18-sided loft's flat faces sit up to 1.1 mm inside the ellipse the shell is
  sampled from, and a shell starting inside zigzags across them (a notched
  fringe). Jitter the edge only at the sides and nape, clip strand strokes at
  the hairline, and paint the band above the hairline as skin, or a white line
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

Cost: a pooled look is 2,971 triangles mean (was 2,051), a cop 3,264, the player
2,770; building the 12 looks takes 22.6 ms on first spawn. Like for like
downtown (13 peds, 22 vehicles) the frame is 387 draws either way and +0.18 %
triangles. An untrimmed 3,361 mean was ~+64k triangles a crowded frame with
shadows, about perfguard's tolerance; the trims (hair columns 36 -> 24, 8-sided
hands, 8-sided nose) cost nothing visible. Phones cast no ped shadows, so there
it is one pass.

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

Current figures, all inside their bands:

| | cadence | step | duty | bob | knee swing | hip height | skate (world) | stance gap worst | mid-swing clearance |
|---|---|---|---|---|---|---|---|---|---|
| walk 1.4 | 106 | 0.79 m | 0.61 | 5.6 cm | 74 deg | 94 % | 2.5 % | 0.1 cm | 7.7 cm |
| brisk 2.2 | 133 | 0.99 m | 0.52 | 5.0 cm | 78 deg | 92 % | 3.0 % | 0.1 cm | 7.1 cm |
| jog 3.5 | 161 | 1.31 m | 0.40 | 8.3 cm | 109 deg | 89 % | 5.2 % | 0.1 cm | 18.2 cm |
| run 5.5 | 183 | 1.80 m | 0.32 | 8.3 cm | 121 deg | 87 % | 6.1 % | 0.2 cm | 22.9 cm |
| sprint 7.5 | 196 | 2.29 m | 0.26 | 8.8 cm | 130 deg | 88 % | 5.0 % | 0.2 cm | 27.5 cm |

Ankle on its limit 6-33 % of a cycle (was 38-74 %). Speed ramp: worst planted
slip 4.2 cm/frame (only while a lock is dragged in a hard deceleration), worst
ankle pop 9.6 cm/frame (touchdown at a 7.2 m/s sprint).

**Hip height at a run is 87 %, and that is honest, not a crouch.** An earlier
96-100 % came from shortening the ankle excursion by a fixed 0.22-0.30 m of
"roll" the sole never actually rolled through, which is why its soles hovered
8 cm. With a rigid foot, a 0.84 m leg spanning a 1.06 m contact travel cannot
keep the hips higher; runners do sit lower through a flexed stance knee. Don't
"fix" it by lengthening the roll again.

On-foot pace is **5.0 m/s running and 7.2 sprinting**. It was 3.6/5.4, lowered
at some point to stop the gait reading as track athletics -- which was the wrong
lever, because the gait keys off `runBlend` and the rig judges it at 1.4/3.5/7.5
where it already passed. The pose was never the speed's problem, and a 16 km
city at 3.6 m/s is a chore.

Two standing traps. `animateWalk` owns `h.phase` -- advancing the cycle anywhere
else reintroduces the cadence/stride split. And the bones are **unscaled**, so a
step in world metres has to be divided by `h.scale` or taller pedestrians
over-stride.

The reference bands in `tools/gait.mjs` are published adult gait-analysis
values -- cadence and step-length curves, duty factor against speed, joint-angle
ranges -- so the rig judges against an outside standard rather than against a
screenshot.

## Parks

Parks come from the green channel of `surface.png` (OSM `leisure=park`,
`landuse=forest/grass`, `natural=wood` and friends), and `inPark()` is a raster
lookup. Nothing has to keep streets out of them any more: roads go where OSM says
they go, which correctly includes Aurora cutting straight through Woodland Park.

Tree scatter is *candidates per chunk*, filtered by `inPark`. At 46 a
chunk-sized park got one tree per 60 m and read as bare ground; it is 230 now.
If you add a large park, check it doesn't look empty.

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

**The electric car is a spec flag, not a special case.** `ev: true` in `TYPES`
switches four things: a sealed nose with one full-width light bar at each end
instead of a grille and paired lamps, a square-root torque falloff instead of a
linear one (an electric motor is at full torque from zero, so it leaps off the
line and runs out of road rather than out of revs), regen at 4.6 m/s² off
throttle against 2.4, and more grip, because the battery floor puts the mass
under the axle line. `audio.js` reads `state.ev` and moves the engine to a
triangle/sine whine an octave and a half up — reassigned only when the mode
flips, since setting `OscillatorNode.type` every frame allocates on some
engines. **This last part cannot be checked headlessly**: the AudioContext
never leaves `suspended` without a real gesture, so `update()` early-returns
before it gets there.

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

`height.png` is 401x401 at 40 m. **That spacing is not free to change**: it is
also the terrain mesh's vertex spacing, and the two have to agree. A finer query
grid floats roads over bulges the mesh doesn't resolve; and at 20 m the mesh
would cost 1.28 M triangles across a 16 km map, which is the whole frame budget.

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

## Geometry building

`Builder` (build.js) accumulates positions/normals/uvs/colors and emits one
`BufferGeometry`. **`quad()` and `tri()` auto-correct winding against the supplied
normal** — this exists because hand-wound horizontal quads were backface-culled,
which made every road surface in the city invisible while the sidewalks (wound
the other way) rendered fine. Don't "optimise" that check away.

`mergeByMaterial()` flattens a group of static meshes into one mesh per material;
landmarks would otherwise cost hundreds of draw calls.

## Draw-call budget

At `high`, perfguard's downtown reads roughly 230 steady draws and 315-330 a
frame, ~1.05-1.16 M triangles a frame (the spread is how much traffic spawned
that boot, not the build). Triangles are up on the pre-import city because the
building density is real; draw calls are not. Flying adds 10-20 draws for the
far massing layer (see "Flying").
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
  articulated wheel groups. Traffic averages ~6,400 triangles a vehicle
  (weighted by `CIVILIAN_TYPES`; the authored van is 6.9k, bus 8.1k, planes
  ~1.5k). `import('./apps/auto/src/vehicles.js')` in Node and read
  `vehicleAssets().types[k]` index counts — no browser needed.
- **characters are 1 draw each.** They're `SkinnedMesh`es over a pool of 12
  shared geometries (`variants()`) plus 4 for cops (`copVariants()`), ~3k
  triangles each, so per-instance cost is a skeleton, not a buffer. **Never
  dispose a pooled geometry** — `makeHumanoid` returns a
  `dispose()` that no-ops unless the character was built `unique`, and
  `PedSystem.remove` must go through it. Disposing it directly yanks the GPU
  buffers out from under every other pedestrian wearing that look.
- every tall building in the whole city is one static "far skyline" mesh.
- **terrain is 12 x 12 tiles.** Tile size trades draw calls against wasted
  triangles, and on a phone the draw calls are what hurt. 20 x 20 put 132 terrain
  meshes on screen at once -- a third of the entire budget -- for ground that is
  mostly behind buildings; 8 x 8 makes each tile 2 km wide on a 16 km map and the
  frustum never culls one.
- parked cars only exist within `PARKED_RADIUS` and hide past 140 m.

`roadLift()` is a 3×3-chunk edge scan, so **anything that samples the ground
more than once a frame computes the lift once and passes it in**: vehicles take
seven samples, the player two, pedestrians one. Calling `groundAt(x, z, y)`
without the 4th argument silently re-runs the scan.

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
| `tools/gait-strip.mjs` | a frame strip of the cycle; forces the player's humanoid visible on the staging point (one boot spawned in a car and shot 12 frames of empty ground) |
| `tools/charshots.mjs [tag] [seed] lineup` | every pooled look plus a cop side by side at 9 m — a single seed says nothing about the pool |
| `tools/crowdshots.mjs [tag]` | 12 pedestrians, one seed per POOLED LOOK, posed at dt = 0 on a real pavement; seeds `1000 + k*7919` landed on one look and photographed the harness |
| `tools/vehshots.mjs <tag> [types] [--street]` | `--street` parks a fixed lineup on the densest commercial street, shot at eye height and raised — a before/after random traffic can't give |
| `tools/flycam.mjs [--jitter]` | a scripted flight: camera measured RELATIVE TO THE PLANE and the plane's on-screen motion, since absolute camera movement at 116 m/s is ~2 m a frame regardless. The autopilot holds 45 m over the terrain under AND 400 m ahead, or the bay dive flies into Queen Anne |
| `tools/camtunnel.mjs` | camera height at stations through bores — nothing through the roof |
| `tools/jank.mjs` | `fwy-bump`, `crossing-clash`, `barrier-on-road` added for the grading (see "Freeway grading") |

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

**Pavement must not cross a carriageway, and the ring is where that breaks.**
Strips stop at `nodeRadius` and `meshNode` fills the corner with a square ring —
but drawn as four whole sides, that ring lays a footpath straight over all four
approach roads. Each side is cut into pieces and the pieces covering an approach
are dropped, leaving pavement on the corners only.

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
reach over a trimmed side and catch cars on the road beside it. A side with a
near-parallel neighbour in its 1.5 m catch fringe (`e.tnb`) catches nothing past
its edge. Narrowing the fringe to `hw + 0.6` everywhere was tried and reverted:
it bought little (182 -> 166 of 1656 samples off the drawn deck at I-5
downtown) and cost a verify approach by SR-99's north portal.

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
- **A piece past a CONTINUED end loses close ties.** Where half-width changes,
  the previous piece extrapolated 7 cm above the next piece's real profile and
  won. It now loses near-ties to the neighbour whose span actually covers the
  point. Past a FREE end (an anchor, a locked deck) it is the only deck there;
  penalising it there cost SR-99's north approach its capture.

**Measure the ride and the profile separately.** Comparing `profAt` with
`groundAt` along the same 3 m steps found the staircase in one step; the
combined number only said "worse". Measured with `tools/jank.mjs`, before
grading -> now:

| check | before | now |
|---|---|---|
| fwy-bump (3 m grade break > 5 %) | 3502 / 69668 (5.03 %) | 1044 / 70624 (1.48 %) |
| fwy-bump over 8 % (felt as a jolt) | 1739 | 631 |
| steps jumping > 0.5 m | 1475 | 512 |
| I-5 ride north of the ship canal, breaks > 5 % | 52 of 518 | 0 of 518 |
| crossing-clash (deck gap < 4.5 m) | 427 / 725 (58.9 %) | 158 / 725 (21.8 %) |
| barrier-on-road | 1958 / 57270 (3.42 %) | 888 / 56841 (1.56 %) |
| bridge (deck buried) | 17 / 6678 | 5 / 6678 |
| sink | 308 / 6925 (4.45 %) | 295 / 6923 (4.26 %) |

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
massing and the layer covers chunks while they build. "Missing chunk in view"
still counts ROADS (1.9 mean) — the far layer covers buildings only. **Watch
flying fps on a real phone.**

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
3. **The twin tubes overlap and walled each other's lanes.** OSM draws the
   double-deck bore as two 14 m roads with centrelines 7.5-11 m apart, which
   overlap for ~2.8 km. `world.inOtherBore()` drops any 3 m wall piece, collision
   and drawn alike, that stands inside another tunnel's carriageway with a deck
   within 1.6 m.
4. **Dive relative to the chord between the END portals, not the nearest one.**
   SR-99's portals sit at 21 m and 0.1 m, so where "nearest" switched, the deck
   jumped +9 -> -11.9 inside 50 m: a 21 m cliff mid-bore.
5. **A second portal must be 150 m+ from the first.** The northbound tube has a
   main-line and a ramp portal ~30 m apart at each end, so its "two portals"
   were one mouth twice.
6. **Twin decks are blended where they overlap**: to their average, fully within
   3 m and fading to nothing at 5 m. With staggered portals they disagreed by
   1.3-2.4 m and the other tube's deck captured the car.

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

### One deck, a lit roof, and no water underground

- **Draw each shared patch once.** Where the twins share a hole, deck and ceiling
  cells are clipped (Sutherland-Hodgman) against the lower-numbered tube's
  rectangle. Edge ends are sheared onto the bisector with the most collinear
  neighbour; square ends overlapped in a wedge inside every bend and gapped
  outside it.
  - Measured with downward rays every 20 m: rays hitting two decks < 10 cm apart
    went **5.7 % -> 1.3 %**.
  - Two cruder ownership rules measured WORSE than master (17 %, 13.6 %), because
    skipping whole cells leaves slivers.
- **The pale wedge in the ceiling was the lamp strip.** A 1 m glow strip ran the
  whole bore, 0.8 m over the clamped chase camera. It is now 1.4 x 0.35 m
  fixtures every 6 m. Near-white share of the upper view went 4.1 % -> 0.0 %.
- **Water does not draw for a camera with 1.5 m+ of ground over it** (each water
  mesh's `onBeforeRender`). Once the deck ran smoothly through sea level, the sea
  plane cut the tube in half. No depth-mask height fixed it: every height from
  0.02 m to 1.2 m failed for a camera 0.5-1 m above the sea. The mask stays at
  0.02 m for views from the street into sub-sea cuttings, and skips quads over
  real water.

| ride from the street (`tools/tunnelride.mjs`) | master | now |
|---|---|---|
| SB, in at Aurora | stops 78 m in, 25 failures (cap) | **0**, 3,634 / 3,659 m |
| NB, in at SODO | surfaces 98 m in, 25 failures | **0**, 3,904 / 3,928 m |
| NB wrong way | 25 | **0** |
| SB wrong way | 25 | 1 (captured by the twin's deck, still 8.5 m under) |
| SR-99 surface past the SB exit | drops at z 1912 | **0 drops, 0 hits**, both ways |

**Order matters.** Each fix exposed the next one. A failed intermediate is not a
failed idea: measure what it exposed first.

## Known gaps

- **Freeway over freeway at interchanges stays as imported.** 110 of the 154
  refused overpasses; see "Don't dip a graded freeway under a ramp". They are
  most of what `barrier-on-road` still finds (another carriageway's tarmac
  over a lane), with 15-26 deg overlaps the split-level pass does not treat.
- **Graded samples off the drawn deck at the densest interchanges**: a raycast
  probe finds 1.5-9 % of samples more than 10 cm off (139 of 1656 at I-5
  downtown, 45 of 480 at Mercer), mostly riding a surface above their own
  profile with nothing drawn there. Not diagnosed further.
- **`survey.mjs` poses its eye-level camera from the node-height chord + 1.9 m**,
  which on a graded deck is not where the road is, so eye-level deck shots
  float. Kept so before and after share framing.
- **SR-99's twin tubes sit side by side, not stacked.** The real bore is double
  deck, and OSM draws it as two overlapping roads. The walls, decks and lids
  above work around that, but three symptoms remain:
  - At the south crossing, the SB tube climbs to its exit through the NB
    interior. On a rendered 60 ms frame the NB car rides the SB deck up to
    2.9 m for 21 m. Stepped rides stay on their own deck.
  - The NB tube runs through the SB exit's open cutting at bore +200..+300, so
    real daylight shows there.
  - portalcheck reports 4 "sliced bore" samples, which is informational.

  The fix is corridor geometry (stacking the twins), not the ground guard.
- **Lids are geometry, not terrain.** Lid tops carry no lane markings (the draped
  markings sit under them), trees and posts beside a lidded road still stand in
  the dug pit, and a car can drive under a bridge slab from its own trench into
  the overcut beside it.
- **Traffic ignores `oneway`.** The flag is imported and sits on every edge
  (`F_ONEWAY`, `F_ONEWAY_REV`), and nothing reads it yet.
- **Buildings are oriented boxes**, not polygons — see "How accurate it actually
  is" for why that was the right trade, but it does mean a curved facade or an
  L-shaped block is squared off.
- **997 buildings (0.8 %) stand over water.** Most are real: Lake Union's
  houseboats, the Alaskan Way piers, Harbor Island. Not worth a filter that would
  also delete the real ones.
