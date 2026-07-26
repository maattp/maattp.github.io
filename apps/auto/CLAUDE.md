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

- **IBL is the ambient.** `textures.js` draws an equirectangular sky; `world.buildSky()`
  sets it as `scene.background` and runs it through `PMREMGenerator` into
  `scene.environment`. The analytic lights are only a key plus a fill, so
  `envMapIntensity` on a material is the main dial for how a surface reads in shade.
- **`PMREMGenerator` is the one half-float exception, and it's guarded.** It
  hard-codes `HalfFloatType` targets internally with no capability check, which
  is exactly what the rest of the pipeline avoids. `halfFloatRenders()` draws a
  white pixel into a half-float target and reads it back before `buildSky` trusts
  it; a definite black falls back to the raw equirect as `scene.environment`
  (`world.envPrefiltered === false`) — no prefiltered roughness mips, so rough
  surfaces reflect too sharply, but the city stays lit instead of going dark.
  Anything that makes the probe inconclusive counts as a pass, so hardware that
  renders correctly today keeps the PMREM path.
- **Tone mapping is ACES**, applied during the scene pass. Exposure lives in main.js.
- **Every surface is a set**: albedo + normal + roughness (+ emissive where there
  are lit windows). Normals are sobel'd from a purpose-drawn *height* pass, not
  from the albedo, so window reveals read as recesses.
- **`postfx.js` is deliberately not three's EffectComposer** — no addon files, and
  every render target can be `UnsignedByteType`. Half-float targets are
  unreliable on iOS (silent black screen), so the scene is tone-mapped into an
  8-bit sRGB target and bloom / FXAA / grade / vignette all work in gamma space.
  If you add a pass, keep it 8-bit.
- **Adaptive quality.** The phone this ships to can't be profiled from here, so
  the game measures its own frame rate and steps `high -> medium -> low`
  (post off, then pixel ratio down). `applyQuality(q, true)` locks it manually.
  When testing headlessly, set `window.__noAutoQuality = true` **before boot** or
  SwiftShader's ~5 fps immediately drops the tier and every screenshot lies.

## Models

Cars and characters are the two things a player looks at closely, and both are
built rather than blocked out:

- **Vehicles** (`vehicles.js`) loft a shell through ~26 sampled cross-sections.
  The bottom edge of that profile **arches up over each wheel** (`archLift`) —
  without the cut, tyres just intersect a straight sill and the whole thing
  reads as a toy. Three geometries per type share materials across all
  instances: `paint` (tinted per car), `trim` (glass/chrome/lenses/rims,
  metallic) and `matte` (tyres/plastic/arches). Cars keep a glass greenhouse
  with a painted roof skin over it; vans, trucks and buses are **painted** bodies
  with glazing cut in — lofting those in glass turns the upper body into one
  dark slab.
- **Characters** (`peds.js`) are `SkinnedMesh`es: one draw call each, but with an
  18-bone skeleton, so elbows and knees actually bend. Geometry comes from a
  pool of 12 pre-built looks (per-instance variety is skeleton, scale and gait),
  and `animateWalk` is a procedural cycle — counter-rotating chest, level head,
  breathing idle, and the legs described below.

### The gait plants feet, it doesn't swing legs

`animateWalk` places each **foot target** and solves the knee to reach it. A leg
alternates a stance half-cycle, where the foot holds a fixed spot and travels
back under the character, and a swing half-cycle, where it arcs forward.

Everything hangs off one number, `stepLength()`. The phase advances
`PI * speed / step` per second and the stance target runs linearly from
`+step/2` to `-step/2`, so **the planted foot moves backwards at exactly the
speed the body moves forwards** — no foot skate, by construction rather than by
tuning. The hips then ride at whatever height the planted leg can actually reach
(`sqrt(REACH² - z²)`), which is where the twice-per-cycle bob comes from; don't
re-add a hand-dialled one.

Rotating the hip on a sine is what this replaced, and it cannot work: sized to
cover the step length *on average*, the foot still sweeps ~57% faster than the
body through mid-stance and slower at the ends, grinding against the ground the
whole way. Measured, the planted foot moved 24 mm/frame while the body moved 25
— the feet were barely holding at all, which is what read as flailing legs. The
IK version measures 1.9 mm. If you touch the legs, re-measure that number:
sample the lower foot's world XZ per frame and compare it against
`speed * dt`.

**Ground contact is capped, and that is what makes running work.** The hips can
only ride as high as the planted leg reaches, so a stance spanning `c` forces
them down to `sqrt(REACH² - (c/2)²)`. Letting stance grow with the step wrecked
the run: at 6.4 m/s the step hit 1.64 m and the hips fell **63 cm** every
stride — the character dropped into the splits twice a second, which is what
"walking is janky, running is jankier" was. `CONTACT_MAX` holds the bob at about
14 cm at every speed; past a jog the step outgrows contact, the duty factor
falls below a half and a flight phase opens. Extra speed buys cadence and air,
not a wider split — which is what people actually do.

**Pose the pelvis before solving the legs, and aim through its inverse.** It
sways, rolls and twists, and the hip sockets ride with it: a 0.09 rad roll lifts
one socket by most of a centimetre. Solving against a character-space target and
then moving the pelvis underneath left the foot floating and creeping. Related:
`REACH_PLANT` is deliberately shorter than `REACH`, because a leg solved to
exactly its reach is pushed past the IK clamp by that same socket rise and comes
up short, lifting the planted foot clear of the ground.

Three standing traps. `animateWalk` owns `h.phase` — advancing the cycle
anywhere else re-introduces exactly the cadence/stride split that caused the
original bug. The bones are **unscaled**, so a step in world metres has to be
divided by `h.scale` or taller pedestrians over-stride. And when measuring
skate, read `h.contact` (0 left, 1 right, −1 airborne) rather than guessing
stance from foot height: a flight phase is not a foot sliding, and counting it
as one buries the real number. Current figures, per frame at 60 fps:

| speed | planted foot moves | body moves | skate | airborne |
|---|---|---|---|---|
| 1.5 m/s | 1.4 mm | 25 mm | 5.7% | 0% |
| 4.2 m/s | 10.2 mm | 70 mm | 14.6% | 18% |
| 7.5 m/s | 21.6 mm | 125 mm | 17.3% | 40% |

The residual is the pelvis's lateral shift and yaw, which a sagittal two-bone
solve cannot absorb; closing it needs a 3-DOF hip.

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
> pedestrians -- reads the same bilinear `terrainHeight()`.

`height.png` is 401x401 at 40 m. **That spacing is not free to change**: it is
also the terrain mesh's vertex spacing, and the two have to agree. A finer query
grid floats roads over bulges the mesh doesn't resolve; and at 20 m the mesh
would cost 1.28 M triangles across a 16 km map, which is the whole frame budget.

Bridges and freeway decks are separate: `city.groundAt(x, z, currentY)` returns
the highest deck below `currentY + 2.6`, else the terrain.

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

Roughly 290-320 draw calls / 400k triangles at `high`, measured across downtown,
Ballard and the spawn. Triangles are up on the pre-import city (~300k) because the
building density is real; draw calls are not.
`__dbg.sceneStats` reports the scene pass specifically — read `renderer.info`
yourself and you'll get the post chain's fullscreen quad instead, because the
counters reset on every `render()`.

Where the budget goes, and the rules that keep it there:

- chunk streaming: `CHUNK = 400`, `NEAR_R = 2` (full detail), `MID_R = 4` (roads
  only). Up to 8 merged meshes per near chunk (road, sidewalk, flat, glow, and
  one per facade material).
- **vehicles are 3 draws each** — `paint` / `trim` / `matte`, sharing geometry
  and the two non-paint materials across every instance. Traffic uses the
  `…GeoW` variants with the wheels baked in; only the player's car calls
  `setDetailed(true)`, which swaps to the wheel-less geometry and adds four
  articulated wheel groups.
- **characters are 1 draw each.** They're `SkinnedMesh`es over a pool of 12
  shared geometries (`variants()`), so per-instance cost is a skeleton, not a
  buffer. **Never dispose a pooled geometry** — `makeHumanoid` returns a
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

## Offline

`sw.js` follows the repo contract (see the `ruin` app): shell-only fast install,
lazy cache-first for the version-stamped Three.js build with copy-forward across
cache bumps, and URL-based `cache: 'no-cache'` revalidation (WebKit refuses to
`fetch()` a navigation-mode Request). **Bump `CACHE` in sw.js on any deploy that
must invalidate immediately.** Never add `vendor/` or `src/` to `SHELL`: a slow
install is what pins iOS players to a stale worker forever.

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
`meshViaduct` offsets each side of the deck at the *node*, and where two spans
meet head to head it mitres them onto one shared point (`deckEdgePoint`). Deck,
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

**A junction square at an elevated node fights the deck.** The square is
horizontal at `n.y + 0.07`; a sloping deck passes through it. `meshNode` skips
the node where two same-width elevated spans meet at under 60°, because the
mitre has already closed that joint. A ramp merge keeps its square: there the
spans are square-ended and the square is what fills the gap. `nodeSurface()`
already skips `n.elev` entirely, so this costs nothing on the lift side —
elevated ground comes from `groundAt`'s per-segment deck query.

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

## Known gaps

- **Tunnels are drawn at ground level.** 102 OSM ways in the box are tunnels
  (SR-99, the Battery St and Mount Baker ridge bores). They keep the network
  connected and are flagged `tunnel` on the edge, but nothing renders a bore, so
  they read as surface roads overlapping the streets above them. Routing is
  right; the picture isn't.
- **Traffic ignores `oneway`.** The flag is imported and sits on every edge
  (`F_ONEWAY`, `F_ONEWAY_REV`), and nothing reads it yet.
- **Buildings are oriented boxes**, not polygons — see "How accurate it actually
  is" for why that was the right trade, but it does mean a curved facade or an
  L-shaped block is squared off.
- **997 buildings (0.8 %) stand over water.** Most are real: Lake Union's
  houseboats, the Alaskan Way piers, Harbor Island. Not worth a filter that would
  also delete the real ones.
