# Auto

An open-world driving/on-foot game set in a ~10.4 km × 10.4 km Seattle. Landscape
iPhone PWA: left thumb stick, right-side buttons, drag the right half to look.

## Layout

```
index.html                  shell: meta, CSS, HUD DOM, control zones
sw.js                       offline cache (see "Offline" below)
vendor/three-0.160.0.module.js   vendored Three.js (NOT a CDN import)
src/three.js                re-export shim; every module imports THREE from here
src/util.js                 math, seeded RNG, 2D geometry helpers
src/geo.js                  ALL Seattle geography (see below)
src/citygen.js              road graph + building footprints (load-time coroutine)
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
```

## Coordinate frame (geo.js)

`+X` = east, `+Z` = south, `Y` = up, **1 unit = 1 metre**. Origin `(0,0)` is
Westlake Center (4th Ave & Pine St).

Downtown's grid is rotated ~32° from true north. `dt(ave, st)` converts downtown
grid coordinates to world metres — `dt(5, 8)` is 5th & Columbia (Columbia
Center). North of Denny Way the districts use a true-north grid (`rot: 0`).
`DT_STREETS` / `DT_AVENUES` give the real street index for each name.

Everything else in geo.js is data: `WATER` polygons, `HILLS` (Queen Anne,
Capitol Hill, Beacon Hill, …), `DISTRICTS` (rotated grid + building style per
neighbourhood), `HIGHWAYS` / `ARTERIALS` / `RAMPS` (hand-drawn polylines; a third
number in a point makes that stretch an elevated deck), `TOWERS` (hand-placed
skyline with real heights), `LANDMARKS` and `PARKS`.

**When editing water or districts, re-run the land/water probe:**

```bash
node --input-type=module -e "
import * as G from './apps/auto/src/geo.js';
console.log(G.isWater(-3000,-2500) /* Magnolia: must be false */,
            G.isWater(-1600,600)   /* Elliott Bay: must be true  */);
"
```
A shoreline polygon that doubles back swallows a whole neighbourhood; that is how
Magnolia disappeared during the first build.

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

Two standing traps. `animateWalk` owns `h.phase` — advancing the cycle anywhere
else re-introduces exactly the cadence/stride split that caused the bug. And the
bones are **unscaled**, so a step in world metres has to be divided by
`h.scale` or taller pedestrians over-stride.

## Keeping buildings out of the road

Two separate things put buildings in the middle of streets, and both are easy to
reintroduce.

**Lots are rectangles, so test them as rectangles.** `roadFit()` measures the
rotated footprint along the line to each road (`|hw*(u·n)| + |hd*(v·n)|`, a box's
support function) against the carriageway *and* the pavement. The old test was a
bounding *circle* of `3 + max(w,d) * 0.28` — roughly 60% of the half-diagonal it
needed to be, which put 880 buildings in the roadway, the worst 14 m deep. A
circle can't be made to work: one large enough to contain the rectangle rejects
most of a block. An oversized lot is **shrunk to fit rather than dropped**,
because a block that came out as a single big lot legitimately overlaps the road
and rejecting it empties the whole block. Shrinking is also why the fix *added*
buildings (8737 → 9284) while removing the overlaps.

**Hand-placed towers don't get a say in where the roads went.** `G.TOWERS` carry
real Seattle coordinates and real footprints, but the road grid is procedural and
laid out with no knowledge of them, and several footprints are simply wider than
the block interior they land in (Columbia Center is 62 m; a downtown block leaves
about 60 × 42 m between kerbs). Untouched, 17 of the 22 had a street through them
and 5 had their centre in a live carriageway. `placeTower()` searches outward for
the nearest spot that fits, so the smallest displacement wins, and shrinks
whatever still doesn't — with a floor, because past a point a landmark stops
being recognisable. `reserved` is built from the *placed* position, not `t.p`.
Residual: UW Campus, which hits the shrink floor and still clips a road.

## The one height surface

`geo.rawTerrainHeight()` is expensive (polygon distance tests), so it is baked
once into a 40 m heightfield (`bakeHeightfield`). **After boot, every consumer —
terrain mesh, road quads, buildings, cars, pedestrians — reads the same bilinear
`terrainHeight()`.** Keep it that way: the moment roads sample a different
surface from the one the terrain mesh is built on, roads sink into the ground.

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
takes its answer outright — a point inside the square is standing on the square.
Maxing it against the strip scan instead gets both signs wrong: junction centres
came back `ROAD_LIFT` and sat 3 cm *inside* the asphalt, and the corners of the
square came back `WALK_LIFT` and floated 19 cm *above* it. `nodeLift` rebuilds
the same square `meshNode` draws (half-size and orientation both from the widest
edge at the node), so if you change one, change the other.

Sidewalks stop short of each junction (`nodeRadius`) and the corner is filled by
a ring drawn in `meshNode`. A strip run end to end marches straight across the
cross street.

**That ring needs its own entry in the lift lookup too.** It sits outside the
junction square, and its diagonal corners are past the end of every strip that
meets the node, so the edge scan finds *nothing* there and returns a lift of 0 —
which dropped anyone standing on a corner the full 44 cm through the pavement.
`nodeSurface()` reports the ring as well as the square, but the two are used
differently: the square **overrides** the scan (it is the top surface there),
while the ring only fills in where the scan came back empty, because along a road
direction the strips overlap the ring and know better than it does. Sampling 250
junctions, corner samples reading below the pavement went 828 → 3.

## Geometry building

`Builder` (build.js) accumulates positions/normals/uvs/colors and emits one
`BufferGeometry`. **`quad()` and `tri()` auto-correct winding against the supplied
normal** — this exists because hand-wound horizontal quads were backface-culled,
which made every road surface in the city invisible while the sidewalks (wound
the other way) rendered fine. Don't "optimise" that check away.

`mergeByMaterial()` flattens a group of static meshes into one mesh per material;
landmarks would otherwise cost hundreds of draw calls.

## Draw-call budget

Roughly 300 draw calls / 300k triangles during a police chase at `high`.
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
- parked cars only exist within `PARKED_RADIUS` and hide past 140 m.

`roadLift()` is a 3×3-chunk edge scan, so **anything that samples the ground
more than once a frame computes the lift once and passes it in**: vehicles take
seven samples, the player two, pedestrians one. Calling `groundAt(x, z, y)`
without the 4th argument silently re-runs the scan.

## Verifying

Headless Chrome + CDP, per the repo's usual recipe. **Bypass the service worker**
(`Network.setBypassServiceWorker`) or you will test a stale build and chase
phantom bugs.

`window.__dbg` exposes `{ game, city, player, world, traffic, peds, scene,
camera, renderer, controls, audio, pickups, G, THREE }`. Useful moves:

```js
__dbg.game.paused = true;                    // freeze and fly the camera
__dbg.player.enterVehicle(__dbg.traffic.nearestEnterable(x, z, 400));
__dbg.controls.btn.gas = true;               // drive
__dbg.controls.stick.y = -1;                 // walk
__dbg.game.addHeat(400);                     // summon the police
```

Note SwiftShader runs at ~5 fps, and `dt` is clamped to 0.06 s, so game time
advances far slower than wall-clock — measure displacement, not elapsed seconds.

## Offline

`sw.js` follows the repo contract (see the `ruin` app): shell-only fast install,
lazy cache-first for the version-stamped Three.js build with copy-forward across
cache bumps, and URL-based `cache: 'no-cache'` revalidation (WebKit refuses to
`fetch()` a navigation-mode Request). **Bump `CACHE` in sw.js on any deploy that
must invalidate immediately.** Never add `vendor/` or `src/` to `SHELL`: a slow
install is what pins iOS players to a stale worker forever.
