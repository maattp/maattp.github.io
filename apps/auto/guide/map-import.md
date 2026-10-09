# Auto: The map import

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Where the map comes from

Seattle is **imported, not generated**. Streets, shoreline, parks, building
footprints and landmark positions are OpenStreetMap; elevation is USGS 3DEP via
the AWS terrain tiles. Nothing about the city's shape is authored here any more.

```
tools/data/washington-latest.osm.pbf   Geofabrik extract (350 MB, gitignored)
tools/data/dem/*.png                   361 terrarium tiles, z14 (~6.4 m/px)
        |  python tools/osm_extract.py            (~3 min, one full scan)
tools/data/raw_*.json                  projected + clipped intermediates
        |  build_raster / build_roads / build_buildings / build_places
apps/auto/data/height.png     781x781 @ 40 m   h = ((R<<8)|G)/10 - 100
apps/auto/data/surface.png   3121x3121 @ 10 m  R = water, G = green
apps/auto/data/lots.png      2168x2168 @ 14.4 m  G = lot code, R = coverage
apps/auto/data/roads.bin      192k nodes, 205k edges        5.74 MB
apps/auto/data/buildings.bin  342k oriented boxes, chunked  4.13 MB
apps/auto/data/places.json    22 landmarks (Smith Tower last), neighbourhoods
apps/auto/data/water.json     lake surface levels
```

With the rail, bike-path, pier and park files, about 10 MB, ~5.6 MB over
the wire (v163). **Licence: OpenStreetMap is ODbL**, so the
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
every road node gets its height from the previous terrain. The raster step
also fits the ground to the streets (`tools/grade_streets.py`, ~2 min), from
`raw_roads.json` and the DEM tiles, keeping clear of the landmarks in the
shipped `places.json` (see "Street grading"). `build_lots.py`
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

## The map grew to 27.6 km (v163)

**`MAP_HALF` is 13800**, up from 13000, so that the Bainbridge ferry lands in
a town: the old west edge ran ~50 m behind Winslow's ferry dock, and
downtown Winslow, SR-305 and the dock's own exit road were 250-800 m past it
-- an arriving boat faced the island sliced off in a straight cliff. 13800 is
a multiple of the 400 m chunk, the 40 m heightfield and the 10 m mask, and
takes in Winslow's Madison Ave (x -13767). Every edge moved 800 m.

- **Change `tools/proj.py` and `geo.js` together**, then the whole import:
  `fetch_dem.py` (361 tiles), `osm_extract.py` and `--lots`,
  `extract_rail.py`, then every build_*.py. **The extract must be re-run**:
  it keeps only what reaches `MAP_HALF + 3000`, and with the raster's
  3000 m pad now past that, coastline between the two was missing and the
  flood fill drowned east Bainbridge. Inside the old box the rebuilt water
  and green masks are identical and the heights differ only in 48 cells at
  the old rim (which the old data clamped).
- **Derived, not hard-coded**: the lot grid (`LOT_N`, 14.4 m), the rail and
  bike-path crops (`EDGE = MAP_HALF - ...`), pickleball's edge. The monorail
  and landmarks were unaffected (the origin did not move).
- BelRed station is on the map now (Link: 24 stations, 8 on the 2 Line).
- verify's "roads under the water" counts the new strip apart from the old
  box (15 decks, 26 street samples: Manitou Beach Drive, SE Cornell Road);
  the old box's streets went 168 -> 183, all Point Monroe Drive, which the old
  edge used to cut short.

**It was paid for.** The cached launch at the 8x phone profile went 20.5-21.0 s
(v162) -> 18.5-18.7 s, and the JS heap 1.09 GB -> ~0.70 GB, on the bigger map:

- `ChunkBuilder` (typed arrays, bbox kept as it builds) for Link's, freight's,
  the piers' and the bike paths' per-chunk builders, and the plain
  `Builder.build()` takes its bounding sphere from one pass over its bbox
  instead of three's two passes through the attribute accessors (~0.9 s of
  a phone boot).
- **Link kept every chunk builder alive** (`this._chunk`, assigned and never
  read): ~130 MB of heap.
- **Piers and bike paths build a 1 km chunk when you first come within
  range**, not at boot (`_build`, one chunk per update after the first):
  ~2 s of every phone launch and ~75 MB of arrays, nearly all of it
  kilometres away and never drawn. Their platforms, `km`, and each
  segment's `drawn` flag (cyclists ride by it) are still worked out at boot.
  On a phone a chunk's arrays go once uploaded and a lost context drops the
  meshes to be built again. verify builds one far chunk of each and raycasts
  the deck.
- Frame CPU is unchanged (perfcpu drive-dt / foot-dt within noise); a
  street-level view draws ~6 % more terrain triangles (the six tiles are
  bigger), which the phone's GPU has room for.

Link's and freight's geometry, left built at boot here because their track
loops carry per-segment state, now streams by chunk: the loop's state is
recorded at boot and replayed per chunk (`LazyChunks`, see "Memory").
(Link's profile solve went into the boot cache in v167.)
`boottime.mjs --twice --prof` now profiles the cached launch only;
`BOOT_TOP=N` lists more functions.

## The map grew to 31.2 km (v167)

**`MAP_HALF` is 15600**, up from 13800, so that Bainbridge is one road
network. In the 27.6 km box it was three -- Winslow and the ferry, Rockaway /
Bill Point, Manitou and the north -- because the roads that join them (Wyatt
Way and Eagle Harbor Drive round the head of Eagle Harbor, New Brooklyn Road,
SR-305 north) run past x -13800: driving between them meant going off-road.
The size was measured, not guessed: a union-find over `raw_roads.json`
clipped to each candidate box joins Winslow and Manitou at 14200 and Rockaway
only at 15200, through a road 20 m inside that edge; 15600 is the next
multiple of 400 m and leaves ~400 m past it. In the game, `findPath` goes
Winslow -> Rockaway in 7.6 km (Winslow Way, Wyatt Way, Eagle Harbor Drive,
Bill Point) and Winslow -> Manitou in 5.9 km (SR-305, Valley Road).

- **Three tools had their own lat/lon box** (`extract_rail.py`,
  `build_piers.py`, `build_bikepaths.py`, 47.490-47.732 N, 122.515-122.160 W,
  from an older map) and silently kept the old extent; they take
  `proj.bbox(500)` now. Check for that before believing a re-import grew
  everything.
- What came in: Link's Shoreline South/148th, Overlake Village and Redmond
  Technology (27 stations, 10 on the 2 Line); both of BNSF's mains end to
  end (no single-track sections left); 342k buildings (+17 %), 192k road
  nodes (+23 %), 386 km of bike paths (+110 km), 2916 piers.
- verify's outer strip (past 13000) holds 31 streets under drawn water, up
  from 26: Skogen Lane and Southworth Drive, the same shore-street class.
- **Paid for with two boot-cache entries**: the bigger box made the cached
  8x phone launch 20.9-21.9 s (v166: 18.8-18.9). `link` keeps Link's two
  profile solves (`_snapshot` / `_restore`: Y, KD, GR, the crossing flags and
  station levels per track) and `freight` keeps the freight profile and its
  raw-road crossings. Cached launch 18.8-19.3 s against v166's 18.4-19.0 in
  the same session; a hash of every track's arrays and 4000 terrain samples
  is identical on a computed and a cached launch. Frame CPU at 8x is
  unchanged (perfcpu drive-dt / foot-dt 12.0-12.6 ms, v166 12.2-13.0); a
  street view draws ~7 % more triangles (bigger terrain tiles).
- `docs/mapgrow2/` has before | after aerials of Eagle Harbor and west
  Bainbridge.

## The islands across the Sound (v151)

**You can fly to Bainbridge, Blake and Vashon, and get back.** Four more
`MARINAS` (landmarks.js): Bainbridge's Rockaway and Manitou beaches (Eagle
Harbor is on the map since v167), Blake Island's marina and Vashon's
north end, each with floatplanes, boats and a jet ski, sited from the drawn
shore like the rest. Their map hellos hint at what is there.

**Easter eggs** (`src/islands.js`), each placed on the nearest dry, open,
fairly level ground to its real site (a footprint test for the bigger ones)
and drawn only within a few hundred metres; each pays once
(localStorage `auto-islands`):
- Vashon: **the bike in the tree** (a fir grown round a bicycle, $250) and a
  **Sasquatch** in the woods above it -- he wanders, and bolts when you
  come within 55 m; see him within 15 m for $1,500.
- Blake: a **cedar longhouse** with carved posts and a **salmon bake** on
  stakes round a fire (stand by it: full health, $100), the island's
  **deer**, who bolt at 30 m, and an **X of driftwood** on the west beach --
  ENTER on it digs up a sea chest ($5,000).
- Bainbridge: the **labyrinth** at Halls Hill; its centre sounds the gong
  ($150).

**Pickleball** (`src/pickleball.js`, `src/pickleballgame.js`), on
Bainbridge where it was invented in 1965: a regulation court (20 x 44 ft,
the kitchen 7 ft each side of a 34 in net) on level ground near Rockaway
Beach, fenced, with a sign; its slab is a platform. ENTER on it plays
singles against the island's champion: rally scoring to 11 (win by 2), an
underhand cross-court serve past the kitchen, the two-bounce rule, and no
volleys from the kitchen -- all enforced. Drag to move; DINK, DRIVE and LOB
(J, K, L); timing is where the ball is in your reach, and the ball goes the
way you are moving. A win pays $150 + $10 a point. The game is pure and
played by bots in Node (rallies to 36 shots, games of ~2-3 minutes).

verify's "the islands" section: the docks and their craft, no site in the
water, every egg found and paid, the Sasquatch fleeing, the dig, standing on
the court and a game to its end. `docs/islands/`.

## The minimap at the map's edge (v166)

**WebKit stretches a `drawImage` whose source rect runs outside the image**,
where Chrome clips it. The minimap draws a window of the map canvas round you;
it spans ~750 m of world either way, so within that of the edge (Winslow and
the west of Bainbridge) that window ran off the canvas and on the iPhone the whole map was stretched -- roads drawn
metres from where you were driving. hud.js clamps the source rect to the
canvas and offsets the destination by the same amount. Chrome never shows it.
