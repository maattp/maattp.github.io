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

To check a change, don't reason about it — measure. Project a world point to
NDC and see which side of the screen it lands on:

```js
// facing heading 0, world +X must land at NEGATIVE ndc.x (screen left)
new THREE.Vector3(p.x + 30, p.y + 1, p.z + 40).project(__dbg.camera).x
```

## The one height surface

`geo.rawTerrainHeight()` is expensive (polygon distance tests), so it is baked
once into a 40 m heightfield (`bakeHeightfield`). **After boot, every consumer —
terrain mesh, road quads, buildings, cars, pedestrians — reads the same bilinear
`terrainHeight()`.** Keep it that way: the moment roads sample a different
surface from the one the terrain mesh is built on, roads sink into the ground.

Bridges and freeway decks are separate: `city.groundAt(x, z, currentY)` returns
the highest deck below `currentY + 2.6`, else the terrain.

## Geometry building

`Builder` (build.js) accumulates positions/normals/uvs/colors and emits one
`BufferGeometry`. **`quad()` and `tri()` auto-correct winding against the supplied
normal** — this exists because hand-wound horizontal quads were backface-culled,
which made every road surface in the city invisible while the sidewalks (wound
the other way) rendered fine. Don't "optimise" that check away.

`mergeByMaterial()` flattens a group of static meshes into one mesh per material;
landmarks would otherwise cost hundreds of draw calls.

## Draw-call budget

Target is ~250 draw calls / ~150k triangles. Costs that crept up during the
build and how they were paid down:

- chunk streaming: `CHUNK = 400`, `NEAR_R = 2` (full detail), `MID_R = 4` (roads
  only). Up to 7 merged meshes per near chunk.
- traffic cars bake their wheels into the detail mesh (2 draws each); only the
  player's car calls `setDetailed(true)` for steerable wheels.
- crowd pedestrians bake their arms into the torso (3 draws each); the player
  passes `animateArms: true` for 5.
- every tall building in the whole city is one static "far skyline" mesh.

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
