# Auto: Phone performance, memory and boot

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

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
  `--profile` adds a sampling CPU profile of each run (it used to never
  return: its pass waited on frames that only the timing pass records).
- **Count draws and GL calls, which are device-independent**: the
  `cats.js`-style frustum breakdown and a wrapped-GL call counter found most
  of what mattered. v76 -> v80 took Yesler Terrace from 338 to 171 draws and
  ~1070 to ~700 GL calls a frame. perfcpu prints `GL calls/frame` for every
  run (all passes; the counting pass shadows the context's methods).
- **One harness at a time, interleaved with the base.** Two perfcpu runs at
  once on this machine are not a comparison: whichever Chrome loses the
  scheduling reads ~45 % slower (a master that measured 12-13 ms alone read
  19.8 ms beside a branch run). Alternate master and branch, sequentially,
  and compare means over two or more rounds.
- **Watch for per-frame program lookups**: a transparent DoubleSide material
  renders in two passes and sets needsUpdate twice a frame; use
  `forceSinglePass`. Wrap `customProgramCacheKey` to catch any other.
- **Keep one hidden class** for anything iterated every frame (vehicles,
  pedestrians): declare every field in the constructor. `forward` is cached
  per heading; don't hold it across a heading change.
- Phone-only paths (all keyed on `ON_PHONE`): far traffic instanced
  (`FAR_LOD`), off-screen traffic past 80 m at half rate, pedestrian animation
  LOD and CPU culling, JS arrays dropped after upload -- chunks, the static
  city, vehicles -- and texture canvases let go (see "Memory"; a lost context
  reloads the page), 2 ms streaming slice while driving.

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

### Standing still costs nothing (v152)

The docks, the bike share and the islands took traffic's list to ~160
vehicles, 114 of them 'apron' -- standing on a dock, a rack or the airfield.
Four fixes, measured with `perfcpu.mjs --throttle=8` against the base in the
same session (CPU/frame mean; frames over 20 ms of 400):

| | before | after |
|---|---|---|
| drive-dt | 13.3 ms, 46 | **10.1 ms, 14** |
| foot-dt | 14.0 ms, 48 | **10.4 ms, 7** |

- **A settled apron vehicle freezes** (traffic.js, the quads' old rule for
  all of them): bikes, aircraft on the ground, and boats more than 120 m
  from you (a nearer one bobs). Within 300 m each used to run the whole
  driving model to stand still. Its matrices freeze too.
- **Car-car collision is sort-and-sweep on x**, and two still vehicles are
  never tested (all-pairs was ~12k tests a frame).
- **A cyclist's limbs are solved within 45 m only** (`_ikFar`), and a
  cyclist is drawn within 180 m (120 on a phone).
- **The minimap redraws at 30 Hz**, and the Link line is drawn only where it
  is on the dial, from points computed once.

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

### The scene graph's own cost: hidden objects, Euler writes, chunk bounds

**three recomposed ~3,600 objects' matrices every frame, and ~3,200 of them
were hidden.** `scene.updateMatrixWorld` walks everything under the scene,
visible or not: the 45 bike-share bikes, each with a rider's 25 bones (29
objects), 25 more apron vehicles with riders, the parked aircraft and boats,
the Link and freight trains out of range (16-24 bones each), the islands'
deer. At the 8x throttle `updateMatrixWorld` + `multiplyMatrices` +
`setFromEuler` were ~4.5 ms of a ~20 ms downtown frame, the top of the
profile. Now:

- **`skipHiddenMatrices(scene)`** (build.js) replaces the scene's own
  `updateMatrixWorld`: a direct child that is hidden is skipped. 3,600 ->
  330-480 objects a frame. **Only the scene's direct children**, because
  their parent never moves (`scene.matrixAutoUpdate` is off): one shown again
  recomposes itself and forces its subtree, exactly what the skipped frames
  would have left. A deeper hidden child cannot be skipped this way -- one
  with `matrixAutoUpdate` off keeps its world matrix only because a moving
  parent forces it. **Anything that reads a hidden top-level object's
  `matrixWorld` must update it itself** (`getWorldPosition` does, so do the
  bellows and the IK). The one reader that didn't, the contact shadow reading
  the player's feet on the frame he gets out of a car, checks
  `scene.userData.matrixSkipped` (what the last update skipped).
- **Freezing keeps the world matrices an object HAS: compose them as you
  freeze.** `updateFarLod` turns off `matrixWorldAutoUpdate` for far cars and
  settled parked / apron vehicles, and a parked car never thaws. A kerbside
  car spawns at 105 m, hidden on a phone (`PARKED_SHOW` 80 m), and settles
  (`_still` 3) in three frames -- frames the hidden-object skip no longer
  composes it in -- so it froze at identity; a car spawned inside the far
  band (60-80 m, most lot cars) froze on its first frame, before any render.
  Both were drawn right while they were far-LOD instances (built from
  `group.matrix`, composed there), and **at the 60 m handover their own
  meshes were drawn at the origin: the car vanished as you drove up to it.**
  On the phone profile 2,723 of the 2,742 near parked cars in view in
  verify's drive (v174-v181; v173: 133, all cars spawned inside the band, a
  latent bug since v78). Desktop never saw it: it shows parked cars to 140 m
  and has no far LOD. The freeze now runs `group.updateMatrixWorld(true)` on
  the frame it freezes (once per car, not per frame). **Anything that turns
  off `matrixWorldAutoUpdate` or `matrixAutoUpdate` must compose first**, and
  a mover of a frozen object (the ferry carries 'free' cars, which never
  freeze while near) must thaw it. verify's "parked cars stay drawn" drives
  four streets and checks every parked car in view within 140 m, each step,
  is drawn whole at its position or by an instance at its position.
- **Euler writes only when the angle changed.** Every write to
  `rotation.x/y/z` (and `.order`) recomputes the quaternion, and
  `Vehicle.sync` runs for every vehicle in the list every frame, parked and
  settled ones too, plus each bicycle's spin meshes. `sync`, `_pedal` and a
  pedestrian's group compare first. Nothing writes those quaternions
  directly, so a skipped write leaves exactly what the write would have.
- **The city's chunk groups are culled whole** (`chunkcull.js`) before three
  tests their meshes: 32-57 of the ~81 groups are outside the view at any
  heading. Each group's bounds (the union of its meshes' spheres) are
  computed once; a group wholly outside the frustum is hidden for the scene
  pass and shown again after -- and shown for the shadow pass inside it (its
  wrapper sits outside shadowcache.js's, so the cache's re-renders see them
  too). Exact: the same draws and triangles and **zero differing pixels**
  against the unculled render at six headings at downtown, Yesler Terrace and
  I-5 (phone profile, shadow cache on). A group holding anything three does
  not cull by its geometry's sphere (instanced, skinned, `frustumCulled`
  off) is left alone. Small: ~2.5 % of the scene pass.

**Traffic and the crowd** (all exact: `aidrive.mjs` and `trafficcheck.mjs`
print identical results before and after):

- **Kerbside parking slots are per edge, worked out once** (`kerbSlots`).
  `updateParked` reran every slot's hash and the water, buildable and
  jump-clear tests for every edge within 105 m every frame -- mostly for
  slots that fail them. 0.4-0.5 -> ~0.1 ms/frame at 8x. The cache is cleared
  past 3,000 edges.
- **The car-ahead scan's path segments are computed once per car**, not a
  `Math.hypot` per segment for every car projected onto them (three more for
  a crossing car). The scan, the IDM and the route planner (the "How the AI
  drives" review's concern) measured 0.7 ms/frame downtown and 1.5 ms on I-5
  at 8x with ~55 driven cars, wrappers included, before this: real (half of
  traffic's time on I-5), but not the frame's problem.
- `Vehicle.bodyR` is kept (it was three `Math.hypot`s a pair in the sweep);
  unattended vehicles share two read-only input objects; the vehicles that
  can knock a pedestrian over are found once a frame, not per pedestrian.

**The HUD writes a readout only when it changes**: money, speed and the
health bar were set every frame, and a `textContent` write replaces the text
node even with the same string.

Measured, perfcpu `--throttle=8`, 400 frames, master and branch alternated
sequentially, mean of two rounds each (draws and GL calls unchanged within
spawn noise):

| 8x, CPU/frame mean; frames over 20 ms of 400 | before | after |
|---|---|---|
| drive-dt (downtown) | 13.7 ms, 66 | **9.0 ms, 7** |
| foot-dt | 12.9 ms, 26 | **8.8 ms, 2** |
| drive-qa (Queen Anne) | 10.9 ms, 8 | **6.3 ms, 0** |
| foot-yt (Yesler Terrace) | 14.0 ms, 49 | **10.3 ms, 13** |
| drive-i5 | 12.9 ms, 40 | **9.4 ms, 10** |
| render system, drive-dt / foot-yt | 8.8 / 9.6 ms | 5.4 / 6.8 ms |
| traffic system, drive-dt / drive-i5 | 2.0 / 2.2 ms | 1.2 / 1.2 ms |

The scene pass alone, on one frozen frame scissored to one pixel (so the
GPU does nothing and submission is what is timed), 8x, the changes switched
in and out on the same scene:

| scene pass CPU, 8x | none | + hidden-object skip | + chunk cull |
|---|---|---|---|
| downtown | 6.6 ms | 4.4 ms | 4.3 ms |
| Yesler Terrace | 6.5 ms | 4.3 ms | 4.3 ms |
| I-5 | 5.1 ms | 2.9 ms | 2.8 ms |

Boot is unchanged (8x, first frame: first launch 44.3 / 43.9 s before, 44.2
/ 43.4 s after; cached 20.7 / 19.6 s before, 20.4 / 19.7 s after). gait.mjs
prints the same, shadowcheck.mjs passes with the same texels, perfguard's
draw and triangle counts hold (its `holes` figure is wall-clock streaming:
master re-checked against its own record read 58 -> 63).

What is left in the profile is per draw: `projectObject`,
`renderBufferDirect`, `setProgram`, the VAO binding checks -- ~200 draws and
~1,250-1,500 GL calls a frame (~6.3 a draw: a VAO bind, the model-view
matrix and the draw each time, texture binds and material uniforms at each
of ~50 material switches, and per posed pedestrian a bone-texture upload of
~10 calls). Not taken, and why:

- **Merging the Link/freight chunk meshes** (~28 of Yesler Terrace's draws
  are rail chunks): each chunk's bed, rails and signs are range-toggled on
  their own, so merged pieces would appear and vanish at other distances.
- **Off-screen traffic at a quarter rate past ~150 m**: invisible, but a
  phone-only path the deterministic traffic harnesses cannot exercise
  (they run the desktop profile), and it changes how those cars drive.
- **An x-sorted broad phase for the car-ahead scan**: exact only if the
  candidates are visited in list order, and cars move during the loop; ~0.3
  ms at 8x was not worth the bookkeeping.
- **Sharing a paint material between cars of one colour** would cut the
  uniform churn between car draws, but every car's `bodyMat` is its own
  (damage, disposal), and paint is being reworked separately.
- **Minimap icons as pre-rendered sprites**: drawImage resamples where the
  vector path does not; not pixel-identical.

### Far terrain is drawn coarse: blocks, strides, stitched edges, one index per tile

**The ground was the biggest thing on screen and nobody could see most of
it.** Six 5.3 km tiles at the full 40 m grid, each drawn whole when any of it
was in the frustum: 793k of the downtown frame's ~1.67 M triangles (48 %) in
14 draws, much of it 8-18 km away under FogExp2, and 145k of the heaviest
tile's 163k vertices were the cut cells' 4 m patches (four vertices to a quad).

`world.js` `updateTerrainLod` / `_composeTerrain` / `cullTerrain`:

- **Blocks of 12 x 12 cells (480 m), a stride per block**: 1 (40 m) out to
  2.5 km, 2 (80 m) to 5 km, 4 (160 m) beyond (`LOD_AT`), by the 3-D distance
  from the CAMERA to the block's box (so a plane high over the city coarsens
  what is below it, as the fog does). `LOD_HYST` 150 m of slack either way,
  re-evaluated every 24 m of camera travel (`LOD_STEP`): 0.05 ms a call.
  Normals and colours stay the fine vertices' own, so a coarse block shades
  as it did; only the silhouette and the 40 m facets go.
- **The vertices never change; each tile's INDEX is composed from the levels**
  just before the tile draws (`mesh.onBeforeRender`, which three runs right
  before the upload): fine cells, or every 2nd / 4th vertex, or nothing. A
  block beside a FINER one fans its border cells through that neighbour's
  vertices (the polygon is the cell's outline plus the neighbour's points on
  that side, fanned from a corner), so the edge is the same line from both
  sides: no cracks, no skirts. (Any stride ratio stitches; neighbours are
  within one level anyway while the `LOD_AT` gaps, 2.5 km, dwarf a block,
  480 m, plus the hysteresis.)
  `tools/terrainseams.mjs` composes every visible tile at 44 camera spots and
  looks for T-junctions (a long boundary edge overlapped by shorter ones): 0;
  with stitching turned off (`SEAMS_BREAK=1`) 38,275, so it does bite.
- **The index lives in ONE shared scratch array** (`terrainLod.s16`, 0.66 MB),
  each tile's attribute a view of its front: the GPU buffer is allocated at
  the tile's full size on its first draw and the compose rewrites the front
  (`addUpdateRange`). The JS side keeps no index per tile -- the old one was
  dropped after upload on a phone and has to stay droppable -- so a compose is
  regenerated from the cut-cell flags and each cut cell's quad mask, never
  from a stored copy. `dropGeometryArrays` leaves `userData.keepIndex`
  geometries' index alone. Composing is safe to share because the upload
  follows in the same call; **never compose a tile outside `onBeforeRender`
  (or a harness that does not draw) and expect the GPU to have it.**
- **Cut cells (portal trenches, rail cuttings, docks) draw only at stride 1.**
  Their 4 m lattice is 121 shared vertices a cell (it was 400); a quad is
  indices, `pMask` records the ones a tunnel deck removes. Terrain vertices
  fell from 162k to 64k on the heaviest tile, and its index went from 32-bit
  to 16-bit. A vertex whose four cells are all cut has no normal from the
  grid minus the cuts, so it takes the full grid's (coarse blocks use it).
- **`cullTerrain` (before the scene pass) draws a tile only if a LIVE block of
  it is in the frustum**, blocks tested by their own spheres: three's test
  is the tile's 3.7 km sphere, which kept ~13 tiles. A block past 16 km (the
  far plane is 9 km DEEP, ~16 km at a landscape frame's corners) is not drawn.
  **Fog is not a reason to hide ground**: with the hide at 7.5 km the far
  houses, which stay until 9 km, floated.
- `terrainHeight()` / `groundAt` read the heightfield, never this mesh, and
  nothing raycasts it, so gameplay is unchanged by construction.

| phone profile, downtown (305, -278) | before | after |
|---|---|---|
| terrain triangles / draws | 795k / 14 | **164k / 12** |
| whole frame | 1.67 M | **1.04 M** |
| the same, 450 m up looking south | 1.57 M (terrain 702k) | 1.03 M (terrain 160k) |
| every terrain vertex, all 36 tiles / all triangles at full detail | 1.75 M / 1,777,110 | **0.96 M** / 1,777,110 (the same) |
| terrain on the GPU, after 90 s low flight + a skydive | 88 MB | **45 MB** |
| GPU peak in that flight (ledger) | 512 MB | **471 MB** |
| terrain JS arrays at the end of boot | 32 MB | 45 MB (fewer tiles uploaded yet; JS + GPU 95 -> 76 MB) |
| boot, 8x throttle: "Raising the terrain" (first / cached) | 11.4 / 2.5 s | 9.2 / 2.1 s |

`tools/tricats.mjs` is the table (`TERRAIN_LOD=off` draws every block at full
detail, the old terrain, from the same build); `tools/terrainlod.mjs` shoots
off / on from the same camera (1.5, 3, 6 km up, the 2.5 km and 5 km bands, a
street, Alki across Elliott Bay). A compose of the busiest tile costs 0.2 ms
on the Mac, and ~7 tiles go dirty per 24 m of camera travel, so the worst
hitch is a few composes in one frame, each uploading a 100-300 KB range.

**Not done: far tiles still upload their whole fine vertex buffer** when first
drawn (the coarse blocks index into it), so a long flight still walks the GPU
total up to ~45 MB of terrain, not the ~12 MB the coarse meshes alone would
take. Fixing it needs a separate small vertex set per tile for the all-coarse
case, and the fine buffer re-uploadable when the tile comes near: the arrays
are dropped after upload on a phone, so that means keeping them (or
regenerating a tile on demand from the heightfield and the memo).

### Memory: one copy, nothing kept from boot, no cache that grows as you fly

**The iPhone ended the page while flying** -- the floatplane low over Fremont
and Green Lake at ~90 m/s, ~45 s after the far layers came on; a week before,
a skydive -- with no JS error: WebKit ending the web process for memory
(Safari reports no JS heap, so the flight recorder could not show it). The
budget the page runs against is everything at once: the JS heap, typed-array
backing stores, canvas backing stores (outside the JS heap in both engines)
and, on WebKit, the GPU process's allocations made for the page.

**Measure it with `tools/memprobe.mjs`** (phone UA and viewport, so every
`ON_PHONE` path is the one measured; Mac GPU; fresh profile):

    AUTO_HTTP_PORT=8000 node tools/memprobe.mjs [--twice] [--fly=S] [--sky]
         [--census] [--tex] [--alloc] [--views=DIR] [--snapshot=FILE]

- heap `gc` is `Runtime.getHeapUsage` after two forced collections, **objects
  plus `backingStorageSize`** (array buffers live outside the V8 heap and
  `usedSize` / `performance.memory` leave them out); `raw` is the same
  uncollected, which is what an OS limit sees at that moment. flycam's
  `heapBootMB` is `performance.memory` (objects only, desktop UA).
- GPU is a ledger of every WebGL allocation call, wrapped before the page
  runs (buffers, texture levels, renderbuffers, minus deletes) plus the
  drawing buffer. `--tex` lists the textures by size and the canvas / bitmap
  sources still held; `--census` the geometry arrays the scene still holds,
  by top-level group, split into held-and-uploaded (pure waste) and held
  only (not drawn yet).
- `--fly=S` is S seconds of real-time flight at >= 90 m/s, 70 m over the
  ground, Fremont -> Green Lake -> Northgate -> Lake City -> the U District ->
  Ballard -> Magnolia; `--sky` 10 s at 1500 m over downtown, then out of the
  door to the ground. `--alloc` samples where the flight's allocations come
  from. `--views=DIR` screenshots beside Link, the freight line and the yard,
  to compare builds by eye where arrays and canvases are let go.
- `tools/heapsnap.mjs FILE` streams a heap snapshot (~1 GB here) and prints
  self size by constructor, retained sizes (dominator tree) and **owners**:
  every node's bytes charged to its first hops from the window, arrays
  folded, objects named by their `name`. `--json` / `--diff` compare two
  snapshots (memprobe `--snapshot-boot=` and `--snapshot=`): what grew.

| phone profile | before | after |
|---|---|---|
| GC'd JS heap incl. array buffers, first launch | 793 MB (447 buffers) | **506 MB** (241) |
| ... cached launch | 817 MB (494) | **494 MB** (238) |
| ... after 120 s of low flight | 862 MB | **485 MB** |
| ... after the skydive | 911 MB | **549 MB** |
| raw JS peak in the 120 s flight / the skydive | 991 / 979 MB | **623 / 603 MB** |
| canvas backing stores held by textures | 96 MB | 42 MB (those never drawn yet) |
| GPU at boot / peak in flight | 428 / 536 MB | 410 / 509 MB |

What held it, and what was done (each its own commit):

- **The static city was held twice on a phone**: chunks already dropped
  their arrays once uploaded, nothing else did. `dropStaticArrays` /
  `dropGeometryArrays` (build.js) now do it for the terrain, the skyline, the
  landmarks, Link's and freight's structure and trains, the golf course, the
  ferries, and every vehicle type's geometry and far LOD (`dropVehicleArrays`,
  after the boot cache's snapshot; traffic builds every far LOD at boot on a
  phone). Bounds are computed first. **A lost context reloads the page on a
  phone** (once a minute at most): nothing can be re-uploaded, and on an
  iPhone a lost context is the GPU process going away under pressure anyway.
  Nothing in the game raycasts; a mesh that rewrites its geometry later
  (the monorail's signal lamps, golf flags) is not in these sets.
- **Every texture kept its canvas** (~95 MB). `releaseTextureSources`
  (memory.js), at the end of the boot after the cache has encoded them: each
  canvas / bitmap / data texture becomes a size-only stub once uploaded and
  current, and its canvas is cut to 0 x 0. Safe because nothing redraws or
  clones a texture after it is made (grep `needsUpdate` before adding one
  that does: it must keep its source). The mid ring's road tints are read
  off two of those canvases, so `world.primeMidTint()` runs first.
- **Link's and freight's structure, ~120 MB of arrays, was built at boot**
  for the whole 300 km while a phone draws 1.9 km. `LazyChunks` (build.js):
  the boot runs the same pass into `SinkBuilder`s and files, per 500 m chunk,
  what drew there -- a run of one track's segments with the loop state at its
  start (`pole` / `colNext`, `pierNext`), a station, an entrance, a crossing,
  the yard, the bascule; `stream` replays a chunk in that order with every
  other chunk sunk, 1.5 ms a frame (all of it at once within the near range,
  so a teleport lands with its rails), and lets chunks 700 m past the build
  range go. Solids, platforms, yard slots and gates come from the boot pass;
  a replay's go to throwaway lists. `tools/railgeomhash.js` (all chunks
  built) is identical to the eager pass: 732 meshes, 130 MB, `56fbab29`.
  The freights' whole-train geometry (~8 MB each) is likewise assembled a
  slice a frame on its way into view (`stepGeometry` / `ensureGeometry`).
- **The query grids were a Map of arrays per cell** (~30 MB each for the
  lift and road grids, ~14 MB for the buildings'). `CellGrid` (citygen.js):
  a dense offset array over the occupied box and one id array, walked as
  `ids[off[c] .. off[c + 1])`. `tools/cityqueryhash.js` hashes 68.6k query
  answers: identical to master, computed and cached.
- **The boot-cache read lived for the whole session** (65 MB on a cached
  launch): `bc` sits in boot()'s closure context, which every listener made
  in boot keeps alive. Its entries are nulled once written; so is the
  vehicles' cached snapshot (`PRE`) on a phone. The 2048x1024 equirect that
  fed the PMREM is disposed (8.4 MB of GPU).
- **Two caches grew without bound while flying**: citygen's `junction()`
  and `world.junctionFor` kept every junction asked for (~1.3 KB each, 28k
  after three minutes of low flight, +36 MB, heading for the whole map's).
  Both are Maps trimmed to the newest half at 16k (`trimOldest`); a junction
  is a pure function of the graph. Three minutes of flight: +4 MB.
  `heapsnap --diff` of boot against a 180 s flight finds nothing else growing.

**The flight recorder carries a memory figure** now: `installGpuLedger`
(memory.js) wraps the context's allocation and delete calls -- never the
binds, which run hundreds of times a frame; what is bound is asked of the
context, which answers from client-side state -- and each snapshot carries
`gpuMB`, `bufMB`, `texMB` and `gpuPeakMB` (MiB, as asked; drivers round up).
Matches memprobe's ledger to the MB.

**What is left** (phone, first launch, by heapsnap owners): the city's own
objects (~220 MB in V8: edges, buildings, graded surfaces, nodes -- V8
boxes every double field, JavaScriptCore does not, so less on the phone),
the 10 m masks (`G`: water, green, lots, ~32 MB, all queried at runtime),
the junction cache (bounded), the sound bank (~15 MB of decoded PCM), the
characters' skinned variants (~11 MB), and chunk / terrain arrays not drawn
yet. On the GPU: textures ~182 MB with mips (the PMREM alone is 25 MB of
RGBA16F, sized by the 2048 equirect; a 1024 one would be 6 MB but blurs the
sharpest reflections), chunk geometry ~110-140 MB, the terrain ~45 MB once
all of it has been seen (~90 before the terrain LOD: its cut cells' vertices). Quantising normals and colours to 16-bit would cut
vertex buffers ~20 % with no visible change, but Metal wants 4-byte vertex
strides (a 6-byte normal would be converted by ANGLE's Metal backend, not
measured here), and 8-bit colours band in the darks. A flight allocates ~54 MB/s (chunk meshing's
array literals, builder growth): V8 collects it in step; nothing here
measures JavaScriptCore's collector.

### The trees' budget (a green Seattle)

The trees (rendering.md, "A green Seattle") were held to a phone budget set
before they were built: at most ~+6 scene draws in a downtown or residential
view, at most +400k triangles in any view, at most +40 MB of GPU at the 90 s
flight's peak, at most +1.5 s on a cached 8x boot. Measured on the phone
profile against master in the same session (`greenshots.mjs --stats`,
`memprobe.mjs --twice --fly=90 --sky`, `boottime.mjs --throttle=8 --twice`);
draws and triangles exclude traffic and pedestrians, which the harness
spawns at random:

| phone profile | before (v196) | trees |
|---|---|---|
| scene draws, city views (capitol/magnolia air, a residential street, foot-dt) | 70-95 | +2 to +4 |
| scene draws, forest from the air (Discovery, Seward, Blake Island) | 4-41 | +4 to +7 |
| scene draws, on foot in Discovery Park (tricats) | 68 | +7 (6 tree tiers) |
| triangles, city views | 0.70-0.95 M | +44k to +118k |
| triangles, forest views | 0.05-0.29 M | -35k to +169k (Blake) |
| GPU at boot, first / cached | 370 / 369 MB | 366 / 365 MB |
| GPU peak, 90 s low flight | 469 MB | 475 MB |
| raw JS heap peak in that flight | 624 MB | 652 MB (mean 568 -> 581) |
| cached boot at 8x (against v193, two rounds alternated) | 22.7 / 24.7 s | 23.9 / 22.9 s |

- **The caps**: a near chunk holds at most `NEAR_CAP` 1,600 trees, a mid
  one `MID_CAP` 650; the mid ring keeps 35 % of forest and 60 % of the rest.
  A far crown is ~550 bytes of GPU and 9-15 triangles. A forested near chunk
  reaches ~1,550 trees, a dense residential one ~900.
- **Near-ring chunks build no slower** (desktop, 25 chunks, median of 3:
  capitol 19.9 -> 18.5 ms, downtown 24.4 -> 19.2, discovery 10.7 -> 6.9,
  wallingford 25.6 -> 26.6): the old trees' 300-vertex canopies are gone and
  most candidates ask the 2 m raster. **Mid-ring chunks build ~1-5 ms
  slower** on the Mac (4-9 ms before): the planting is in the streamer's
  fixed slice, so it costs fill rate in flight, not frame time.
- **The mid ring plants late** (rendering.md, "A green Seattle"): a checker
  found mid builds ~1.75x slower with trees and, on the phone's fixed 2 ms
  slice, twice the chunks still pending after a minute of 8x low flight
  (Discovery 14/15 -> 28/24, Seward 32/28 -> 51/36). Built bare while
  anything else waits, planted when the streamer is idle, and a road-less
  chunk with no green skipped at once, `greenshots.mjs` with
  `GREEN_FLIGHT=x0,z0,x1,z1` (phone profile, 8x, 90 m/s at 70 m) reads like
  master: toward Discovery 71/64/61/27/1/0 pending at 10-60 s against
  71/63/60/30/14/0, toward Seward 61/41/53/53/27/33 against 61/43/48/48/46/32
  (master alone read 18 and 32 at 60 s on two runs: this machine's noise).
- **The refresh** (`TreeSystem.update`) is 0.1-0.3 ms on the Mac when it
  runs (10 m moved or 9 degrees turned) and does not appear in the top 40
  of an 8x profile. The planting does (`plantTrees` 1.4-2.5 %, `occupancy`
  0.7 % of busy time while chunks stream).
- **Shadow pass**: +1-2 draws a frame on a phone (the near crowns, movers).
- perfcpu's milliseconds moved 2x between runs of the SAME build on this
  machine (other agents' load); its draw and GL-call counts did not: scene
  draws +3-6 (drive-dt 185 -> 190, foot-dt 201 -> 205, drive-qa 149 -> 155),
  GL calls +20-80 a frame.

## The flight recorder (v168)

**A crash on the iPhone leaves nothing behind**: WebKit ending the page for
memory, or its GPU process going away, throws no error a harness could see,
and desktop Chrome does not reproduce it (a 1500 m jump from the 747 ran
clean headless, flat heap, no exceptions). So the game keeps a record:

- `index.html`'s first classic script owns it (`window.__flight`), so it runs
  even when a module never loads: the boot log's lines, every error (with the
  top of its stack) and rejection, page visibility, `pagehide`. Saved to
  localStorage (`auto-flight`) every 2 s and at once on an error.
- main.js `flightTick` adds a snapshot a second (the last 12 are kept): mode
  (`foot`, `sky:free`, `jumbo:air`...), position and height over the ground,
  speed, fps, quality, draws, triangles, geometries, textures, programs,
  chunks built, cars, peds, the JS heap where the browser reports one (not
  Safari), and what the GPU holds (`gpuMB` / `bufMB` / `texMB` /
  `gpuPeakMB`, from memory.js's ledger -- Safari's only memory figure; see
  "Memory"); and an event whenever the mode, `world.playerFlying` or the far
  layers change, and on WebGL context loss and restore.
- At launch the previous record moves to `auto-flight-prev`; if it was left
  `visible` (not hidden, not closed) the page ended while on screen, which is
  a crash: a toast says so, and **Pause -> Last session log -> Show** prints
  it with a Copy button, for pasting into a bug report.

Tested with CDP `Page.crash` mid-skydive: the next launch flagged the session
and its last events were the climb in the 747 and the jump.

## Boot time and the boot cache

**`tools/boottime.mjs [--throttle=8] [--twice] [--prof]`** times every loading
message on the phone profile, with the CPU throttled from before navigation.
`--twice` reloads in the same browser profile and times the second launch
(and prints the first launch's phases too); `BOOT_PROBE='<expr>'` evaluates
after each launch (hash the city there to prove a cached launch builds the
same city as a computed one); `BOOT_PROF_OUT=<file>` keeps `--prof`'s raw
profile, which DevTools opens.

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
| `link` | link.js `_snapshot` / `_restore`: both profile solves per track (v167) | ~6 MB |
| `freight` | freight.js constructor: the profile and raw-road crossings per track (v167) | ~1.4 MB |
| `memo` | `memo(key, make)` everywhere: many smaller results in one entry (below) | ~23 MB |

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

**It has grown back since.** At v172, `boottime.mjs --throttle=8` reads
~44 s for a first launch and ~20 s cached. The cached launch's biggest
steps are not in the cache at all: Placing the landmarks ~6.1 s, Waking the
city 3.7-4.3 s, Raising the terrain ~3.6 s (first launch: landmarks 9.3,
waking 7.4, terrain 7.3, grading the freeways 6.5). The landmarks are the
next thing worth a cache entry.

### The boot memo: the scattered work, kept in one entry

**Most of what was left was not one big solve but a dozen searches and
indexes**, each 0.1-1.3 s at 8x, none worth an entry of its own. bootcache.js's
`memo(key, make, ok)` answers what an earlier launch of the build kept under
`key`, else runs `make()` and keeps its answer; main.js writes them all as
one `memo` entry with the rest ("Remembering the city", ~0.6 s more on a
first launch). `memoPeek` / `memoPut` are the two halves, for a result made
piecemeal inside a loop that has other work to do. What is kept:

| keys | what | MB |
|---|---|---|
| `terrain:<tx>,<tz>` | each terrain tile's cut cells (`cellCut`) and every cut cell's 11 x 11 patch heights (`patchHeights`): both read the carve | 2.9 |
| `terrain:tint:*`, `terrain:sphere:*` | the tile's vertex colours (`groundTint`), its bounding sphere | 7.1 |
| `grid:lift`, `grid:road` | citygen's roadLift / onRoad query grids, as columns (`gridMemo`: cell key, list start, edge ids) | 10.3 |
| `beach:<i>` | each beach's candidate prop points: dry sand, level, off roads and buildings, with the shore distance | 0.5 |
| `piers`, `piers:plats`, `piers:sheds` | each pier's verdict and deck height, the walkable squares, the sheds standing in salt water | 0.6 |
| `traffic:components` | traffic's directed components (`directedComponents`) | 0.8 |
| `marina:<i>`, `pickups`, `respawns`, `freight:ground:<k>`, `bikes:drawn` | the marinas' shore/deep-water searches, the pickup spots, the hospitals' verges and street nodes, the freight profile's carved ground, which bike-path pieces are drawn | 0.7 |

**A memoised value is plain data that nothing mutates after `memo` returns
it**: the computed value is written at the END of the boot, so an edit made
in between is read back by the next launch as if it had been computed.
`ok(v)` checks its shape (a refusal computes, as on a first launch); a cached
launch's grid lists are `Int32Array` views of one id array, which every
consumer reads the way it read the arrays (`length` and index).

**The `buildings` entry had exactly that bug**:
`packBuildings` kept citygen's per-chunk cover array (`built`) by reference,
the tarmac pass then added each chunk's paved area to it, and a cached
launch unpacked that and added the tarmac again. Every cached launch tinted
the ground more built-up than the first launch of its build (the terrain's
vertex colours hashed differently; nothing else did). It packs a copy now.

Also: the terrain's index is a typed array (pushing ~3.6 M indices onto a
plain array was ~0.4 s at 8x; since the terrain LOD that one only feeds the
normals, and what is drawn is composed per frame), its normals and bounding spheres are three's
own `computeVertexNormals` / `computeBoundingSphere` arithmetic on the plain
arrays (`vertexNormals`, `boundingSphere`: the same values to the bit), the
patches go through a `ChunkBuilder`, and two basketball courts' stored spots
are current again (see "Basketball in the parks").

**Proof**: a `BOOT_PROBE` hash of every terrain tile's attributes, index and
sphere, the landmark root, the tunnel water mask, the city's platforms,
solids and clear circles, the hoops, pickups and piers, 4000 terrain samples,
20000 onRoad / groundAt / roadsNear queries, every Link and freight track
array, the bike paths' drawn flags and traffic's components is identical on
a computed and a cached launch, and identical to master's computed launch
(whose cached launch differs only in the terrain colours, the bug above).
`perfcpu --cached` times frames on a cached launch (its grid lists are the
views): unchanged against master's cached launch.

| 8x-throttled, first frame (3 rounds, master and branch alternated) | before | after |
|---|---|---|
| first launch of a build | 49.2-52.7 s | 44.8-54.4 s (noisy machine; writing the cache 2.0-2.5 -> 2.5-3.3 s) |
| later launches (cached) | 21.0-22.9 s | **16.0-18.3 s** |
| cached: Placing the landmarks | 6.5-6.7 s | 4.4-4.9 s |
| cached: Waking the city | 3.6-4.0 s | 2.0-2.5 s |
| cached: Raising the terrain | 3.6-4.0 s | 1.3-1.7 s |

Two more pairs on a machine at load 20 read the same gap: cached 25.1 / 26.6
s -> 19.2 / 17.4 s, first launch 53.4 / 60.8 s -> 54.8 / 53.9 s. A first
launch is no slower: writing the memo (~0.6-0.8 s) is paid back by the two
hoops courts no longer searching.

**What is left in a cached launch** (8x profile): Link's and freight's
geometry, ~2.1 s together, was the biggest single item; it now streams by
chunk (`LazyChunks`, "Memory": the boot keeps only the recording pass, and
the cached 8x launch went 14.0 -> 13.3 s). Then the first warm frames and shader programs
(~1.5 s, GPU: see "Hitches", not to be front-loaded further), the first
chunks (~1 s), the landmark meshes (~1 s), the street graph's own objects,
and Link's four-minute service settle (`makeTrains`, ~0.45 s).
