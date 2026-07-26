# Zombies

Round-based survival FPS in a single hand-authored bunker map ("Der Bunker").
Landscape-only. Touch + full iOS controller + keyboard/mouse. Infinite rounds,
gets harder forever, no win condition.

Stack: **Three.js 0.160** (ES module via jsdelivr importmap), one self-contained
`index.html`, no build step, no textures, no audio files — the whole game is
geometry, shaders and synthesised WebAudio.

## Version Management

**Bump `const VERSION` in `index.html` once per PR** (rendered bottom-right via
`$('ver').textContent`). ASSERT the old value is present when bumping — silent
no-op bumps against a stale base have shipped in this repo before. Also bump
`CACHE` in `sw.js` (`zombies-vN`) when a PR must reach installed players
promptly, since the worker serves stale-while-revalidate.

## Landscape only

Decided with the user. The manifest asks for `orientation: landscape`, but iOS
ignores that, so `#rot` (a CSS `@media (orientation: portrait)` overlay) is the
real gate and the game **pauses** behind it. Do not add a portrait layout.

`fovFor(aspect, ads)` still ramps the vertical FOV at portrait aspects: three's
`fov` is vertical, and a fixed 68° on a 0.46 aspect collapses the horizontal
view to ~37°. That path only runs while the gate is up, but keep it.

## Laws learned the hard way

These each cost a real debugging session. Do not undo them.

- **INSTANCED COLOUR NEEDS BOTH.** three's `color_fragment` applies `vColor`
  only under `USE_COLOR`, and `USE_COLOR` makes the vertex shader read a `color`
  attribute. An `InstancedMesh` with `instanceColor` therefore needs
  `vertexColors: true` **and** a real colour attribute on its geometry, or every
  instance renders pure black. `instColors()` exists for exactly this.
- **SHADER INJECTION POINT.** `opaque_fragment` is the chunk that writes
  `gl_FragColor` from `outgoingLight`; everything after it (tonemapping,
  colorspace, fog, dithering) operates on `gl_FragColor`. Adding to
  `outgoingLight` at `dithering_fragment` compiles, runs, and does nothing — the
  entire baked lighting solve was invisible until it moved up.
- **LIGHT UNITS.** `PointLight.intensity` is candela in three r155+ (physically
  correct lighting is the default). Values tuned for the legacy model read as
  pitch black at any useful range.
- **BAKED LIGHT NEEDS TESSELLATION.** Baked light lives on vertices, so a
  full-height wall drawn as one quad has lighting at its four corners and
  nothing in between — a lamp-lit room renders as a black box. `Builder.grid()`
  subdivides every large flat surface; visibility rays are memoised per
  (light, tile) so the bake stays fast.
- **THE FLOW FIELD STORES DIRECTIONS, NOT DISTANCES.** Sampling the distance
  field and differentiating it is the obvious approach and it is wrong on a
  1.2 m grid: every floor cell touches a wall, and however wall cells are folded
  into the interpolation they compete with the ~1.0-per-cell real gradient. The
  steer ends up pointing along the wall, and zombies oscillate a few metres from
  the player on the far side of it, forever — a round that can never end.
  Interpolating unit direction vectors is unconditionally stable: wall cells
  simply carry no vote.
- **UNSTICK GUARANTEE.** A round ends only when the last body dies, so one
  wedged zombie stalls the game permanently. Progress is measured as movement
  *along the route* (`Level.sampleDist` delta), not distance travelled — a body
  oscillating between two cells covers ground while getting nowhere. After 7 s
  of no progress it is relocated to a live window.
- **AI LINE OF SIGHT ≠ BULLET RAY.** `Level.rayWall` lets a shot through a
  window opening; `Level.losBlocked` does not. Zombies must use the latter or
  they beeline into window walls.
- **MINIMUM STANDOFF.** Zombies do not collide with the player, so a packed
  crowd squeezes bodies to ~0.3 m — a head inside the near plane. They are held
  at 0.95 m; attack reach is 1.75 m, so this costs no threat.
- **No post-processing, no render targets.** iOS WebKit silently blackscreens
  HalfFloat render targets. Every effect here is geometry- or material-level.
- **`frustumCulled = false` on every InstancedMesh** whose matrices hold world
  coordinates — three culls against the base geometry's bounding sphere at the
  mesh origin.

## Character models

`loft()` (module scope, shared with the first-person hands) sweeps a closed tube
through elliptical stations, with an optional per-angle `shape` callback for
silhouette (brow, nose, jaw, calf, thumb, eye sockets) and a `tone` callback for
per-angle vertex colour (hairline, sunken sockets, mouth shadow). That is the
entire modelling toolkit; everything is built once at boot.

Station colours are **relative, around 1.0**, because three multiplies vertex
colour by instance colour: the geometry carries the detail (collar, cuff, hem,
knuckles, hair) and the instance carries the hue. That is how every zombie is
individually coloured — shirt, trousers and skin all separate — with one shared
material per part class.

`RIG` drives **both** the visible pose and the hit shapes, so proportions cannot
silently desync from what you can shoot. Head centre sits at 1.60 m against a
1.62 m eye height: aiming level at a zombie on your own floor is a headshot.

Rendering is ~11 draw calls for the whole horde regardless of size (one
`InstancedMesh` per body part, no skeletons — limb transforms are solved
directly from a gait phase each frame).

## Map

`MAP` is an ASCII grid; every derived structure (geometry, navigation, spawn
logic, zone gating, lighting bake) is rebuilt from it at boot. Adding a room,
moving a wall-buy or cutting a new window is a text edit.

```
'#' wall   '.' floor   ' ' outside   'W' window (breach point)
'1'-'6' purchasable barrier (BARRIERS)   'a'-'h' wall-buy (WALLBUYS)
'X' power switch   'S' player spawn
```

A wall-mounted char must have **exactly one** adjacent floor tile or its facing
is ambiguous — the boot assert catches row-width mistakes, but not this. Zones
gate spawning: a window only goes live once its room has been bought open, so
opening the map genuinely widens the front you have to hold.

## What is deliberately not built (v1 scope, agreed with the user)

Mystery box, Pack-a-Punch, perk machines, power-ups (Max Ammo / Insta-Kill /
Nuke / Double Points / Carpenter), hellhound rounds. The registries they would
hang off (`WEAPONS`, `WALLBUYS`, `BARRIERS`, zone gating, the `Interact.scan()`
candidate list) are already the extension points — adding a perk machine is a
map char plus a table entry plus a branch in `activate()`.

Also absent: multiplayer, saves mid-run, multi-floor maps (the nav grid is
single-layer).

## Testing

`window.__dbg` drives everything headlessly: `start()`, `stepN(n)`,
`snapshot()`, `noRender(on)` (**essential** — a long soak under a software
rasteriser is dominated by the draw, not the simulation), `give(key)`,
`points(n)`, `openAll()`, `power()`, `teleport(x,z)`, `setRound(n)`,
`killAll()`, `navAt(x,z)`, plus input stubs `move/look/hold/tap`.

`?nosw=1` skips service-worker registration — **use it for all localhost
testing**, the SW serves stale builds otherwise. `?bot=1` is an attract-mode
autopilot; `?autostart=1` skips the title.

`verify.mjs` is the regression gate — see its header for the exact commands.
Note the two bot rules it encodes, because a naive bot reports false failures:
only shoot what `losBlocked` says you can see, and **stay on a target until it
drops** (re-picking the nearest body every frame in a crowd of 24 spreads damage
across all of them and kills none).
