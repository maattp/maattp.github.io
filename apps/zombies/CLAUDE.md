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
silently desync from what you can shoot. **HEAD-OVER-EYE LAW:** the head sphere
must span the 1.62 m eye height at every value of the per-body scale jitter, or
a level shot sails over the shorter bodies and connecting comes down to random
spread. headY 1.63 with scale ≥ 0.96 holds across the range; changing either
value means re-checking the other, and `verify.mjs` asserts it against the
actual sampled distribution.

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
'J' 'C' 'T' 'Q' perk machine (PERKS, wall-mounted)
'M' mystery box location (floor; one active at a time)
'X' power switch   'S' player spawn
```

A wall-mounted char must have **exactly one** adjacent floor tile or its facing
is ambiguous — the boot assert catches row-width mistakes, but not this. Zones
gate spawning: a window only goes live once its room has been bought open, so
opening the map genuinely widens the front you have to hold.

## Meta systems (V2)

`Drops`, `Box` and `Perks` sit between the round director and the interaction
scanner. All three hang off structures the core loop already had, which is what
the V1 registries were for.

- **Power-ups** drop from kills on a per-round budget with a minimum gap, so a
  long round cannot rain them. `POWERUPS` entries with `secs` install a timed
  effect (`Drops.instakill`, `Drops.pointsMult`); the rest apply once. The Nuke
  marks its victims `noDrop` before killing them — a nuke that rolled another
  nuke would cascade.
- **The mystery box** always starts in the lobby (a box you cannot reach on
  round one is not a choice, it is a locked door), relocates after a random
  number of uses, and **moves its solid tile with it** — the box is furniture,
  so `Level.solid` and the nav field are updated on every move. Its display
  weapon is the *viewmodel* clone with unlit materials and the hand groups
  stripped; there is no second set of world-space weapon meshes.
- **Perks** are read at the point of use (`maxHp()`, `reloadMul()`, `rpmMul()`),
  never baked into player state, so gaining or losing one takes effect with no
  bookkeeping. Quick Revive is the one with real machinery: it downs you instead
  of killing you, makes you untouchable while down, and is **consumed**, so it
  must be re-bought — that is the solo behaviour, and it is what stops it being
  a free extra life every round.

Adding another perk is one `PERKS` entry, one map char, and one multiplier read.

## Pack-a-Punch and hellhounds (V3)

- **Pack-a-Punch** is multipliers on the base weapon resolved inside `spec()`,
  not a second weapon table. Every consumer of weapon stats already goes through
  `spec()`, so damage, magazine, reserve, reload, Max Ammo and the HUD name all
  pick the upgrade up for free; a new weapon needs nothing beyond an optional
  `PAP_NAMES` entry. Upgraded weapons get their **own** viewmodel with cloned,
  tinted materials — tinting the shared ones in place would recolour every
  weapon that uses them and stay tinted afterwards.
- **Hellhounds** are a second enemy sharing the zombie list (`kind: 'dog'`)
  rather than a parallel system. Damage, the ray tests, the flow field, the
  round counters and the drop rolls are already written and correct; duplicating
  them is how two enemy types drift apart. Only the model, the gait, the hit
  shape and the spawn are branched. `KIND` holds the per-type combat numbers,
  `DRIG` the per-type hit shape — a dog's head sphere sits **in front of** its
  body, not on top of it, so the ray test offsets by facing.
- Dogs spawn out of the floor anywhere reachable and at least 6 m away, ignoring
  windows entirely. That is the whole reason a dog round feels different from a
  zombie round despite sharing the AI.

**PAD BINDINGS FOLLOW CALL OF DUTY, NOT CONVENIENCE.** Hold L3 to sprint —
never a toggle, which latches the state after the stick is released so you round
a corner already sprinting and unable to shoot. R3 melees. B melees as well
(harmless, and it is what earlier builds trained) but menus back out on B only,
because a stick-click is a melee button and should not also mean "go back".

**A CURSOR IS NOT AN ACTION.** The controller could confirm and go back for a
whole release before it could show you WHICH item it was about to press, and the
first attempt at a fix navigated perfectly while highlighting nothing — the ring
was gated on `Input.st.mode`, which only flips to `'pad'` on stick movement, so a
player using the d-pad and A never saw it. The ring keys off `st.hasPad`, and any
button press now counts as pad input. `verify.mjs` asserts the ring is actually
applied (`menu().ringed`), not merely that navigation works; asserting behaviour
without appearance is what let the original bug ship.

**A CHECK THAT SHARES STATE WITH THE ROUND IS NOT A CHECK.** The down-state
interaction test passed against a deliberately broken build because the round
was live and spawning zombies were tearing the very window it was measuring.
Any check that asserts on a specific window, drop or body must first quiet the
round (`Zombies.reset()`, `Round.R.phase = 'idle'`). Always confirm a new check
FAILS against the bug it is meant to catch — two of the checks here did not,
until they were isolated.

**PRECONDITIONS LIVE IN THE SYSTEM, NOT THE PROMPT.** `Pap.insert()`,
`Perks.buy()` and `Box.open()` each re-check power / zone access themselves. The
interaction scanner already gates them, but a rule enforced only in the UI is
one caller away from being bypassed — verify caught exactly that on
Pack-a-Punch, which happily upgraded a weapon with the power off.

## Playtest laws (V2)

From the first real session on a phone. Each of these was a complaint, not a
theory:

- **Windows must be the brightest thing on a wall.** Walls read as black and
  breach points were hard to find, because the authored lamps are sparse and a
  boarded window is dark timber on a dark wall against a night sky. Every window
  now carries an always-on cool moonlight spill, and the boards carry a brighter
  baked term than the wall behind them. Do not remove either: the contrast is
  the whole reason a barricade is legible across a room.
- **ADS aligns the SIGHT LINE, not the weapon.** Dropping the model at screen
  centre put the receiver on top of whatever you were aiming at. `ViewModel.
  SIGHT_Y` holds each weapon's sight height and ADS offsets by it, which puts
  the body below the crosshair where it belongs. A new weapon needs an entry.
- **Repair must beat one zombie's teardown.** Boards came down faster than any
  player could replace them, which reads as unfair rather than tense. Tearing is
  ~2.25 s a plank falling to ~0.9 s deep, with an extra beat before the first
  plank; repair is 0.3 s a plank. Keep repair comfortably ahead.
- **The early ramp has to let the starting kit work.** Round 2 was reported as
  already hard: round 1 -> 2 raised the count 67% *and* doubled the headshots
  needed (150 -> 250 hp), and 10 zombies at 5 body shots each exceeded the
  M1911's entire ammo supply — unwinnable without perfect aim, not difficult.
  Counts open at 6/8/12/17 and the pistol hits harder, so rounds 1-3 are
  clearable with what you start with and round 4 is where a wall gun becomes
  necessary. `verify.mjs` asserts this directly (ammo needed vs ammo carried),
  because it is the kind of thing a late-game tuning pass silently breaks.
- **Menus must fit a 390 px-tall viewport.** A landscape phone is short; the
  menu stack was authored at a comfortable height and ran off the bottom. The
  `max-height: 470px` block is not cosmetic.
- **COLOUR CONSTANTS ARE sRGB UNLESS YOU SAY OTHERWISE.** `new THREE.Color(hex)`
  is read as sRGB and converted to linear by ColorManagement, so a hex that looks
  like 0.19 grey reaches the shader at about 0.03 — a 6x crush. Several rounds of
  "the rooms are still too dark" were spent nudging numbers that were being
  gamma-crushed on the way in. Ambient is authored with
  `setRGB(..., THREE.LinearSRGBColorSpace)`; do the same for anything whose value
  the bake maths depends on.
- **WRAPPED DIFFUSE, NOT HARD N·L.** Measured, walls came out 83-90% pure black
  against 55% for floors under the same lamps, because a wall's normal is
  near-perpendicular to the direction of a ceiling light. Wrapping the diffuse
  term (`(nd + 0.55) / 1.55`) is what makes a room read as a room; it also stands
  in for the bounce light a single-pass bake has no other way to get. Every zone
  additionally carries one dim always-on fill so an unpowered room is gloomy
  rather than a black void.
- **BOARDS MUST FIT THEIR OPENING.** Planks were authored at `1.02 * TILE`
  against a `2 * WIN_HW * TILE` (1.008 m) opening, so the ends overhung the frame
  and poked through the window reveals — from any oblique angle you saw plank
  stubs floating in the dark cavity beside the window.
- **A mechanic nobody can find does not exist.** A player asked whether
  reloading was possible at all — it always was (button, `R`, `X`, and an
  auto-reload on a dry trigger), but nothing announced it. The dry-mag hint and
  the pulsing reload button are not decoration.

## What is deliberately not built

Pack-a-Punch, hellhound rounds, multiplayer, mid-run saves, and multi-floor maps
(the nav grid is single-layer).

## Audio

All synthesised, no files. Signal path is voices -> `master` -> compressor ->
destination, with a parallel convolution reverb (`route(node, send)`) fed from a
synthesised impulse. Two things that were missing and mattered more than any
individual voice:

- **A limiter on the master.** Dozens of one-shot voices summed with no headroom
  management, so a firefight clipped into mush while a distant groan was
  inaudible.
- **Reverb.** The bunker is concrete and everything was landing bone dry, which
  is most of why the mix read as thin. Distant sources send MORE to the reverb,
  which is what sells distance better than volume alone.

A gunshot is five layers — action transient, supersonic crack, barrel body, sub
thump, and a long tail sent almost entirely to the reverb. The tail is what makes
it a rifle in a concrete room rather than a click in a vacuum.

`verify.mjs` fires every voice once: a broken node graph is a silent runtime
throw inside a one-shot, not a missing file, so nothing else would catch it.

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
