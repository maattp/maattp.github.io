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

## One grid per patch of ground, and no crossing without a junction

Two rules keep the street network coherent. Both were absent, and together they
made the map read as scribble.

**Exactly one district owns any point.** The polygons in geo.js are hand-drawn
and 25 of the 32 overlap something — Belltown is 62% covered by Uptown and South
Lake Union. Overlap is harmless where neighbours share a street angle and fatal
where they don't: downtown runs 58° off true north and its neighbours run true,
so laying both grids on the same block gives two sets of streets meeting at 58°.
`districtOwner()` resolves it — **the smallest polygon covering a point wins**,
which matches how the data is drawn (a specific neighbourhood sitting inside a
sprawling one should keep its own grid). Ties fall back to declaration order so
the result never depends on sort stability. Node placement, `link()` and the
building block centres all consult it.

**Every ground-level crossing gets a node.** `planarize()` splits each pair of
crossing edges and puts a junction at the intersection. Without it an arterial
drawn through a district's grid simply passed over it: **896 crossings carried
no node**, which is why roads looked stacked rather than connected, and why
traffic could never turn off an arterial. Elevated edges are skipped — a bridge
over a street is a crossing that is *supposed* to have no junction. It rebuilds
through `addEdge`, which recomputes headings and drops the sub-4 m slivers a
split leaves behind.

To check both at once, count ground-level segment intersections whose edges
share no node. It must be zero.

## Parks

**The block grid does not run through a park.** Buildings already skipped them,
so paving one produced a green rectangle with streets crossing it and nothing on
them — a road to nowhere. `citygen` skips park ground for both node placement
and `link()`. Hand-drawn arterials and highways in step 2 still go where they
are drawn, which is correct: Aurora really does cut through Woodland Park.

Tree scatter is *candidates per chunk*, filtered by `inPark`. At 46 a
chunk-sized park got one tree per 60 m and read as bare ground; it is 230 now.
If you add a large park, check it doesn't look empty.

## How closely this matches real Seattle

Downtown is good and the outskirts are not, and the error is not a uniform
scale, so relative geography breaks down as you go out. Measured against real
lat/lon converted about Westlake Center:

| landmark | error | | landmark | error |
|---|---|---|---|---|
| Pike Place Market | 165 m | | Gas Works Park | 518 m |
| Seattle Central Library | 205 m | | Husky Stadium | 1399 m |
| Space Needle | 274 m | | Alki Beach | 2664 m |
| Lumen Field | 414 m | | Green Lake Park | 3029 m |
| Kerry Park | 594 m | | Seward Park | 4250 m |

The game/real distance ratio averages 0.76 but ranges **0.55 to 1.16** — so it
isn't a deliberate uniform compression, it's drift. `MAP_HALF` is 5200 m and
Seward Park is genuinely 9.3 km out, so 1:1 will never fit; a *consistent* scale
would still fix the relative layout.

**Seattle Center has been rebuilt from real coordinates** and is the worked
example of how to fix a district. Everything there was placed by converting
lat/lon about Westlake Center (`M_LON = 111320·cos 47.61°`):

- Needle, MoPOP and the Arena sat 140–290 m west of true, which is what put
  Climate Pledge Arena on the Elliott Bay shoreline. They are now at their
  converted positions.
- The campus rect is set off the four streets that bound it: 1st Ave N
  (x −1396), 5th Ave N (−735), Denny Way (z −790), Mercer St (−1469).
- Mercer St was drawn at z ≈ −1085, nearly 400 m south of true, so it ran past
  the Space Needle instead of bounding the campus. Denny Way was ~200 m south.
- **Alaskan Way's north end was `[-1150,-1000]` — the Space Needle.** A seawall
  road terminating in the middle of the campus, and why MoPOP had a street
  through it. Elliott Ave W cut the same corner about 400 m inland of the real
  road.
- The shore itself drifted east going north, ~450 m of it by Seattle Center,
  leaving metres of land between 1st Ave N and the bay. Pulled back west.

Result: no edge of any class crosses the campus, MoPOP is 134 m from the nearest
road, and the Arena is 570 m from the water against about 700 m in reality.

**When you edit the shoreline, diff the land/water map, don't just spot-check
it.** Sample a grid before and after and count points that flipped: the failure
that matters is land becoming water (a doubled-back polygon swallowing a
neighbourhood, which is how Magnolia disappeared). This edit flipped 0 points to
water and 0.34 km² to land, which is the strip that should always have been
there.

The rest of the outskirts have not been touched and still carry the drift in the
table above.

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

**Nothing may stand where the player is put down.** `G.KEEP_CLEAR` (spawn and
the hospital respawn) is enforced by a filter pass at the end of the building
step. This used to hold by luck — `SPAWN` sits on a block edge — until lots
started being shrunk to fit rather than dropped, which put a tower back on 4th &
Olive and left the player permanently jammed. `player.blocked()` also lets you
move when you are *already* inside a footprint: refusing every direction is how
that failure presents, and it looks exactly like the walk animation playing
while nobody moves. Clipping out beats being stuck. Note the symptom gives no
visual clue — 1.5 m inside a footprint edge you are flush against the facade
with pavement in front of you, which reads as standing on the street.

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

**Steer outside the spin.** A wheel carries a roll on X and a steer on Y, and
Euler order decides which is applied in whose frame. The default `XYZ` builds
`Rx·Ry`: the wheel is steered and then rolled about the *car's* X axis rather
than its own axle, so a turned front wheel tumbles instead of rolling — the axle
tilts off horizontal by `asin(sin(steer)·sin(spin))`, about 30° at half lock.
That is the wheel wobble. `rotation.order = 'YXZ'` gives `Ry·Rx`: roll on the
axle, then steer the lot.

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

**Road markings flashing was two carriageways in the same place.** The hand-drawn
arterials and highways overlap each other and the district grids — 187
near-parallel pairs, and beside the spawn a street and a ramp run 0.7 m apart.
Both drew a full-width surface, each with its own centre line, and the depth
buffer picked a winner per pixel per frame: the road flips between one yellow
line and two. `city.roadCoveredAt()` ranks by width then edge order, and
`meshRoad` skips any 16 m segment a higher-ranked road already paves. Only the
surface is dropped — the edge stays in the graph and traffic still routes over
it. Around the spawn, road area carrying two parallel carriageways went 70.9%
→ 2.4%, and the city emits 22% fewer road quads.

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

## Nothing stands on the water, and parked cars sit on the slope

**`chain()` refuses to lay a ground-level edge whose midpoint is over water.**
The hand-drawn polylines carry the usual positional drift, which had put four
arterials — Aurora, Westlake, Dexter and Fairview — straight through Lake Union
at 4 to 9 m below the surface, and Delridge Way through Elliott Bay: 182 edges
in all. A span meant to cross water is marked elevated in the data and is left
alone. Absent beats submerged, and connectivity went *up* (98.1% → 98.4%),
because those edges only ever connected things across a lake.

**Dropping the edge is damage control, not a fix.** The route still has a hole
in it, and if the hole happens to sit at the end of a deck, the viaduct ramps
down into open water — which is what Aurora did: 1.3 km of it was drawn through
Lake Union at ground level, the ship-canal third of that was the only part
marked elevated, and the bridge's south end touched down 200 m offshore. You
could not drive the length of the map on the one road that is meant for it.
Measured as the longest gap between consecutive nodes on the route, Aurora went
**949 m → 76 m** (55 m is the normal node spacing).

`city.waterDrops` records every edge dropped this way, so the condition can be
asserted on instead of being discovered by driving into a lake. **A named
through route is not allowed to appear in it.** Thirteen still do — Westlake,
Dexter, Fairview, Eastlake, Delridge, Alaskan Way and others.

**The lakes are where they are; move the road.** Lake Union is drawn about
600 m west of its converted position, which is the whole reason its shore roads
end up in it, but shifting the polygon east would put 0.8 km² of built South
Lake Union and Eastlake under water — the Magnolia failure again, in the
direction that actually destroys a neighbourhood. Shrinking water is safe;
growing it is not. Aurora was re-routed instead, into the empty 580 m strip
between the west shore (x ≈ −880) and Queen Anne Ave N (−1460), which is also
where the real road sits relative to the water.

The exception is Green Lake, where Aurora now passes **east** and the real road
passes west. Going west means threading between the lake's west shore (−1500)
and Phinney Ave N (−1690), and the north–south compression out here — Green
Lake to the Aurora Bridge is 3.7 km in reality and about 700 m on this map —
turns that into a 64° dogleg. The wrong side of a lake beats a hairpin.

**`Vehicle.place()` sets pitch and roll, not just height.** A parked car never
runs `update()`, so left at zero pitch it stays level on a hillside street and
its downhill end is buried. That was the sunken cars on Queen Anne — a 20% grade
needs `atan(0.2)` ≈ 0.2 rad of pitch, and it was getting none.
