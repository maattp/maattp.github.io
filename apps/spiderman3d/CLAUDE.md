# Spider-Man 3D

Two-hand, portrait, 3D open-world web-swinger over a procedural Manhattan.
Same idioms as pixelrun/marble: one self-contained `index.html`, fixed-timestep
sim, `__dbg` harness, shell-only stale-while-revalidate service worker.
Three.js r160 ES modules from the jsdelivr CDN (marble's importmap pattern) —
no post-processing, no render targets (so the iOS HalfFloat trap doesn't apply).

## Version Management

**IMPORTANT: bump `const VERSION` in `index.html` once per PR.** It renders as
`V1` bottom-right in the HUD. When bumping, ASSERT the old value is present
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
- Version badge must be visible on the **title screen** (`#tver`), not just
  the in-game HUD.

## Manhattan geography (V4)

The island is rough real Manhattan: 21.6 km Battery (z = Z0, south) → Inwood,
+z uptown, +x east. Layout is data-driven — `W_PTS`/`C_PTS` are piecewise
width/centerline profiles in km-from-Battery (widest ~3.7 km at 14th St,
spine drifting east going north); the shoreline slab, `insideIsland()`, bot
recentering, and respawn all derive from them. The real grid: avenues `AV` =
272 m (N-S), streets `ST` = 80 m (E-W), 2-3 buildings per block.
`nbhHeight(t, e)` encodes the skyline bands: FiDi cluster, low
SoHo/Village, Hudson Yards west at ~4.5-5.1 km, Midtown supertall canyon
(7-8.8 km, Billionaires' Row at the top), UES/UWS park-front walls, low
Harlem/Heights/Inwood. Parks (Central Park 8.7-12.8 km + reservoir, Battery,
Washington/Madison/Bryant Sq, Riverside + East River shore strips) are
building-free; **Central Park is deliberately unswingable open ground** —
crossing it on foot is the real-Manhattan tradeoff, not a bug. Individual
buildings are invented; only scale/layout/heights follow reality. ~7k
buildings / ~42k anchors — one InstancedMesh, fine on mobile; keep it that
way (no per-building meshes).

## Physics tuning contract

Constants at the top of the module script are coupled — the comment block
there is the source of truth. Key laws:

- `REEL` (rope shortens while held) is the *only* energy injection; terminal
  speed is bounded by `DRAG_K` (~62 m/s). No hidden speed boosts.
- Rope = position projection + kill outward radial velocity, 2 iterations at
  120 Hz (`SDT`). Don't drop the sim to 60 Hz without re-checking constraint
  stability at top speed.
- City pitch (`PITCH` 44 m) vs `LEN_IDEAL` (38 m) vs `ANCHOR_R` (85 m): a
  swing released over the grid must always find a next anchor. Retune one,
  re-run the bot sweep.

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
landscape layout, bridges, pedestrians/traffic, Broadway's diagonal,
terrain elevation (northern ridges), landmark buildings.
