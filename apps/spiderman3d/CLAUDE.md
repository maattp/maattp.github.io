# Spider-Man 3D

Two-hand, portrait, 3D open-world web-swinger over a procedural Manhattan.
Same idioms as pixelrun/marble: one self-contained `index.html`, fixed-timestep
sim, `__dbg` harness, shell-only stale-while-revalidate service worker.
Three.js r160 ES modules from the jsdelivr CDN (marble's importmap pattern) —
no post-processing, no render targets (so the iOS HalfFloat trap doesn't apply).

## Version Management

**IMPORTANT: bump `const VERSION` in `index.html` once per PR.** It renders
top-right on the title screen ONLY (`#tver` — see the V5 badge law below). When bumping, ASSERT the old value is present
(check open PRs for the true latest). When a PR should reach installed players
promptly, also bump `CACHE` (`spiderman3d-vN`) in `sw.js`.

## Control model (the design contract — survey-locked V1)

Decided explicitly with the user before V1 — do not change without a
re-decision:

- **Hold-to-swing** (not tap-toggle): finger down on a screen half = that
  hand's web attaches and you swing; lift = release and fly. Both halves at
  once = double-line swing (two rope constraints, stabler and straighter).
- **Assisted auto-anchor** (not physical raycast): `pickAnchor()` scores roof
  points — ahead of travel, matching that hand's side, rope length near
  `LEN_IDEAL`, elevation near ~50°; behind is heavily penalized (forward-flow
  game). Whiffs only in genuinely open areas (park, water) and shows a fizzle
  puff; while held with no rope it retries every 8 steps so swings chain.
- **Gyro tilt + swing-side steering**: tilt is continuous lateral
  steer (grounded: heading turn; airborne: lateral accel perpendicular to
  travel); which hand you swing with provides the coarse arc. iOS needs the
  one-time DeviceOrientation permission — requested from the GO button tap.
  If no gyro reading ever arrives (permission denied, or no sensor),
  dragging a held thumb sideways steers instead (`gyroLive` flag in
  `readTilt()`) — the game must never be unsteerable (PR #301 review).
- **Auto-run, no fail state**: grounded = always running forward at ≥ `RUN`;
  landing momentum bleeds off at `RUN_DECEL`, never below `RUN`, never stops,
  never moves backward. Falling to the street just means you keep running.
- **Water = splash + respawn** on the nearest street, momentum reset.
- Press while grounded = **web-leap** (jump impulse, rope attaches on the next
  steps if one is in range — so plain jump and swing-start are the same verb).
  Keeping a finger held on the ground auto re-leaps after 0.22 s: chained
  swings by just holding.
- Landing always clears ropes (they must never drag you along the ground).

## Web wrapping (V2)

Ropes never pass through buildings. Each rope is a pivot chain
(`r.pivots`: anchor → bends → player); the pendulum constraint acts from the
LAST pivot with `r.len - r.usedLen`. Laws:

- **Anchors sit OUTSIDE roof corners** (outset `o` = 0.5, +0.15 above roof) so
  a straight rope to a fresh anchor never grazes its own building — this is
  what lets `segBlocked()`/`findBend()` treat every box uniformly. Never move
  anchors back inside the footprint, and keep `o` comfortably above `SHRINK`
  (0.25): `o - SHRINK` is the float-safety gap the whole invariant rests on.
- **Attach requires line of sight**: `pickAnchor()` sorts candidates by score
  and takes the best one `segBlocked()` clears (top 6 tried).
- **Wrap**: when the segment to the active pivot crosses a box below its roof
  (2D Liang-Barsky vs `SHRINK`-shrunk rects, height checked at the crossing),
  a bend is pushed at the entered face's nearest vertical corner edge, nudged
  0.3 outward. **Unwrap** pops when the line to the *previous* pivot is clear.
  Wrapping shortens the effective radius → corner slingshot; that's a feature,
  don't "fix" the speed-up.
- **Snap**: > 5 pivots or effective length < 5.5 m breaks the web (no
  tangled/stuck states). Reel floors at `usedLen + 6`.
- Known limitation: the bend nudge doesn't check *other* nearby buildings, so
  in dense configurations a bend can land inside a neighbor and churn
  wrap→rewrap until the 5-pivot snap resolves it (extra snaps, never a clip).
- `__dbg.wrapStats` counts wrap/unwrap/snap/losReject — the bot sweep should
  show wraps > 0, and dead-hang wall-pins should be rare now.

## Handedness law (V3 — the playtest mirror bug)

For travel direction `f`, anatomical/screen **right = (-f.z, 0, f.x)** — the
same rule as a camera facing `f`. V2 shipped the mirror image and every
control read swapped (right press → left web, inverted air steer). Every
consumer must use this form: anchor side scoring, airborne tilt force, the
character's limb placement (model faces +z, so its right arm sits at **-x**),
bot steering, whiff puff offset. All lateral math goes through the
`rightOf(f)` helper — never inline the formula; that's how the mirror
shipped in the first place.

Other V3 playtest laws:

- **Rope ratchet**: the constraint takes up slack (`len` shrinks to closest
  approach, floor `usedLen + 6`) so a street-level web-leap engages the
  pendulum instead of dead-hopping. Don't remove it, and keep `JUMP_V` high
  enough (~15) that a leap clears the ratchet floor.
- **Wall pushout runs grounded AND airborne**, for any point > 1 m below a
  roof; landing snaps only from within 1 m *above-ish* (`pos.y > sup - 1`).
  V2 ran pushout only airborne — street runners entering a footprint
  teleported to the roof via the support snap.
- **iOS standalone fullscreen** uses pixelrun's documented fix verbatim:
  `@media (display-mode: standalone)` extends html/body/canvas/overlays by
  `env(safe-area-inset-top)`, `viewH()` sizes from `screen` when
  `navigator.standalone`, and `resize` re-runs at 350/1200 ms. Don't size
  from bare `innerHeight`.
- The version badge lives **ONLY on the title screen** (`#tver`, top-right) —
  user decision, V5; do not add an in-game version badge. Top-anchored
  because iOS standalone reports `safe-area-inset-bottom` as 0 (the layout
  viewport stops short of the home indicator), so bottom-anchored HUD text
  hides under the swipe bar. The in-game top-right corner belongs to the
  **minimap** (`#mini`): full-island silhouette prerendered from the same
  W/C profiles + parks + Broadway, player dot stamped at the HUD tick.
- **No in-game instruction text** (user decision, V5): the HUD is speed +
  minimap only; all control instructions live on the title screen.
- **Ground decals need depth headroom (V5)**: lawns/reservoir/Broadway ribbon
  are near-coplanar with the island slab and z-fight at distance ("Central
  Park flashes") without BOTH a real y gap (≥ 0.2 m) and `polygonOffset`.
  Camera near plane is 0.5 for the same reason — near distance dominates
  depth precision; don't drop it back to 0.1. Sidewalk plinth padding skips
  park-facing sides (a padded plinth under a lawn is back inside z-fight
  range). Parks are physically 0.2 m raised terraces and sidewalks are
  physically 0.3 m curbs (`supportAt` knows both, plinth rects are hashed in
  `pHash`) — the runner stands ON lawns and sidewalks, never shin-deep in
  visual-only geometry. Any new raised ground visual must get a `supportAt`
  entry.

## Manhattan geography (V4)

The island is rough real Manhattan: 21.6 km Battery (z = Z0, south) → Inwood,
+z uptown. **AXIS LAW (V6): +x is WEST** — in a y-up right-handed world with
+z = north, a body facing north has its right hand (east) at -x. V5 shipped
the island east-west mirrored because "west" was placed at low x; every
east/west feature (centerline drift, Hudson Yards, Riverside, Broadway's
curve, square parks) now follows the axis law, and the minimap draws -x
(east) on the RIGHT so it reads as a normal north-up map AND the dot moves
the same direction you steer. If you add geography, check it against this. Layout is data-driven — `W_PTS`/`C_PTS` are piecewise
width/centerline profiles in km-from-Battery (widest ~3.7 km at 14th St,
spine drifting east going north); the shoreline slab, `insideIsland()`, bot
recentering, and respawn all derive from them. The real grid: avenues `AV` =
272 m (N-S), streets `ST` = 80 m (E-W), 2-3 buildings per block.
`nbhBand(t, e)` encodes the skyline bands: FiDi cluster, low
SoHo/Village, Hudson Yards west at ~4.5-5.1 km, Midtown supertall canyon
(7-8.8 km, Billionaires' Row at the top), UES/UWS park-front walls, low
Harlem/Heights/Inwood. The band also picks the **block fabric** (this is the
realism contract for building placement): base ≤ 26 → rowhouse street walls
(two contiguous party-wall rows of 16-42 m lots facing the streets, courtyard
gap mid-block, zero side gaps); base ≤ 55 → mid-rise frontage segments;
tall/supertall bands → 1-3 office slabs with plaza gaps, and footprints
shrink for h > 300 (slender supertalls). **Broadway** (`BWAY_PTS`, island-
relative like the bands) is the one diagonal: spine downtown, cutting west
past Union/Madison/Herald/Times Squares to Columbus Circle, up the west
side, back to the spine in Inwood — a ribbon mesh draws it, and
`placeBuilding()` carves crossing buildings into **stair-stepped wedge
slices** (2-5 z-strips, each clipped to the corridor at its own latitude, min
4 m wide, `small` anchors, face rings on the WIDEST slice only — one ring
set per crossing building — shared `grp` facade color so a wedge reads as
one building) — Flatiron-style prows out of pure AABBs. The
world stays axis-aligned boxes ONLY; never introduce rotated footprints —
the whole rope/collision stack depends on it. Parks (Central Park 8.7-12.8 km + reservoir,
Battery, Washington/Tompkins/Union/Madison/Bryant Sq, Riverside + East River
shore strips) are building-free; **Central Park is deliberately unswingable
open ground** — crossing it on foot is the real-Manhattan tradeoff, not a
bug. Individual buildings are invented; only scale/layout/fabric/heights
follow reality. ~21.6k buildings / ~113k anchors (rowhouses: roof corners only;
bigger footprints + long-edge midpoints; mid-FACE rings above 90 m — always
including a street-reachable ring at 55 m, the guarantee that supertall
canyons are swingable from the ground) — one InstancedMesh + one per-block
plinth mesh; keep it that way (no per-building meshes).

## Graphics architecture (V7)

**NO post-processing / render targets anywhere** — iOS WebKit silently
blackscreens HalfFloat RTs (repo memory); every effect below is
geometry/material-level. The pillars:

- **World-space procedural surfaces** (`surfaceMat()` injects into
  MeshLambertMaterial): because every surface is axis-aligned, facades and
  pavement derive their pattern from WORLD position — windows are exact
  meters at any building size, zero textures, one material per class.
  Buildings get window grids (sparse fraction lit via `surfGlow` — EMISSIVE,
  so they read on shaded facades), storefront bases, gravel roofs; plinths
  get expansion joints; asphalt gets lane dashes + zebra crosswalks derived
  from the same AV/ST grid constants; water and the reservoir animate via
  `uTime` (tick `timeUniforms` in frame()).
- **Sky dome** (ShaderMaterial, fog:false, renderOrder -1, follows camera):
  horizon haze must match `scene.fog` color.
- **Set dressing** (water towers on mid-rise roofs, park trees) is instanced
  and decor-only — the one sanctioned exception to the supportAt law; small
  enough that clipping is acceptable.
- **Rig**: jointed shoulder→elbow→hand and hip→knee chains (`buildArm`/
  `buildLeg`); run cycle with knee lift, swing tuck scaled by speed,
  reaching arm aims at the last rope pivot. Feet sit at y=0 exactly.
- **Webs** are pooled 3D cylinder strands laid along the pivot chain (max 6
  segments/hand), not lines.
- **Speed feel**: FOV 76→98 with speed, camera banks with tilt, additive
  streak lines past the camera (>17 m/s), additive motion trail (>20 m/s),
  landing dust ring. Faster tuning: REEL 4.6 / DRAG_K 0.0053 (terminal
  ~69 m/s) / PUMP 15 to 20 m/s.
- Title overlay is translucent — the live city renders behind it.

## Physics tuning contract

Constants at the top of the module script are coupled — the comment block
there is the source of truth. Key laws:

- `REEL` (rope shortens while held) is the *only* energy injection; terminal
  speed is bounded by `DRAG_K` (~62 m/s). No hidden speed boosts.
- Rope = position projection + kill outward radial velocity, 2 iterations at
  120 Hz (`SDT`). Don't drop the sim to 60 Hz without re-checking constraint
  stability at top speed.
- Grid (`ST` 80 m streets / `AV` 272 m avenues — see Manhattan geography
  above) vs `LEN_IDEAL` (38 m) vs `ANCHOR_R` (85 m): a swing released over
  the grid must always find a next anchor, and tall buildings must keep the
  55 m street-reachable face ring. Retune any of these, re-run the bot sweep.

## Testing

`window.__dbg`: `start()`, `stepN(n)` (synchronous fast-forward, returns
snapshot), `snapshot()`, `press('L'|'R')`/`release(side)`, `tilt(v)`/
`clearTilt()`, `pickAnchor(side)`, `supportAt(x,z)`, `errors`, live `P` /
`buildings` / `anchors` / `bot`. `?bot=1` = attract-mode autopilot (swings,
steers back from the island edge); `?autostart=1` skips the title;
`?nosw=1` skips service-worker registration (**use it for all localhost
testing** — the SW serves stale builds otherwise); `?seed=N` reseeds the city.

**`verify.mjs` is the regression gate**: with a local HTTP server + headless
Chrome running (setup commands in its header), `node apps/spiderman3d/verify.mjs`
runs a 90 sim-second bot sweep asserting no JS errors, no rope segment ever
crossing a building, and mean speed ≥ 8 m/s (dead-hang canary). Run it after
touching any coupled physics constant or the wrap/anchor geometry. For visual
checks, screenshot via CDP at deviceScaleFactor 3 (see repo memory recipe).

## Not yet built (deliberate V1 cuts)

Sound, haptics, objectives/missions, real building graphics (windows,
textures), horizontal roof-edge rope wrap (vertical-corner wrap only),
landscape layout, bridges, pedestrians/traffic, terrain elevation
(northern ridges), landmark buildings.
