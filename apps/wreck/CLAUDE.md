# Wreck & Ruin

Endless physics demolition sandbox: drive a crane truck through an infinite
procedurally generated countryside and smash every building with a wrecking
ball on a real simulated chain. Landscape-only. Touch + gamepad + keyboard.

## Version Management

**Bump `const VERSION` in `index.html` once per PR** (shown bottom-right of the
title screen). ASSERT the old value when bumping (repo-wide rule — silent
no-op bumps have shipped). Bump `CACHE` in `sw.js` (`wreck-vN`) when a deploy
must reach installed players promptly.

## Stack

- **Three.js 0.160** (ES modules via jsdelivr importmap) + **Rapier 3D 0.19.3**
  (`rapier3d-compat` — WASM inlined as base64, one self-contained .mjs).
- All three CDN files are pinned versions, cached cache-first by `sw.js`
  (same pattern as fablekart's pinned Three.js). Game runs fully offline.
- One inline `<script type="module">`; no build step.

## Physics architecture (hard-won — do not casually retune)

- World gravity −22 (gamey heft). Fixed 60Hz step, ≤4 catch-up steps/frame.
- **Chain**: kinematic "tip" anchor + N capsule links + ball, spherical
  impulse joints. `numSolverIterations = 8`. **Link density is derived from
  the equipped ball's mass (ratio ~10:1 ball:link)** — at ~100:1 the solver
  detonates the chain (verified). Ball + links have CCD enabled.
- **The tip anchor chases its target with a per-step speed cap (0.42/step)** —
  teleporting it across the boom's swing arc in one frame is what used to
  explode the rig. The ball's linear velocity is hard-capped at 55 and cab
  slew accelerates smoothly (instant reversals whip-crack the chain). A
  failsafe rebuilds the rig if the ball ever ends up > 2.5× chain length
  from the anchor (`rig.resets` counts this; expect 0 in normal play, ~1 per
  1600-step slew-reversal torture run — more than that means a regression).
- Winch = the anchor sliding down a virtual rail from boom tip to near
  ground; the visual hoist cable stretches tip→anchor. Boom pitch is fixed.
- Collision groups: world/blocks 0x0001 (filter 7), chain+ball 0x0002
  (filter 1 — no self-collision, no truck), truck kinematic 0x0004 (filter 1).
- **Truck is kinematic**, driven by an arcade model on the terrain *function*
  (never raycasts); pitch/roll from 3-point height sampling.
- **Terrain**: `terrainH(x,z)` = hills flattened along a winding road
  (`roadZ(x)`) and around building pads. Chunked 48m heightfields
  (`heights[ix * n + iz]` — this indexing is load-bearing, verified by
  `__dbg.terrainProbe()` ≈ 0.5m; the transpose reads ~3.8m off).
- **Contact-force scoring**: only when the ball hits a BLOCK collider
  (`collMap`) — terrain/truck contacts must never score (the ball dragging
  on dirt farmed thousands of points before this guard).

## Rendering

ACES tone mapping (exposure 1.0) + a PMREM RoomEnvironment for Standard-material
ambient — but env light washes the toy palette out fast, so every material
carries a tuned `envMapIntensity` (terrain 0.15, blocks 0.35, truck 0.5) and
the terrain colors are pre-deepened to survive ACES. Gradient-canvas sky dome,
mountain ring + sun disc follow the truck (infinitely far). Blocks are ONE
InstancedMesh of `RoundedBoxGeometry` (bevel highlights) with per-instance HSL
jitter. Road dashes + bush/rock scatter are per-chunk InstancedMeshes disposed
with the chunk. Impact shards: `burst()` pool, purely visual.
`world.numSolverIterations` was verified to be a real accessor on
rapier3d-compat 0.19.3 (prototype getter/setter — not a silent expando).

## World generation

Deterministic from lot index: `lotAt(k)` at x≈30k, alternating road sides,
seeded mulberry32 per lot. Archetypes: house, tower, factory (chimney!),
water tower, office, diner, billboard + `furnish()` street props (trees,
parked cars, lamps, fences, crates) — every piece is a physical block.
Blocks spawn asleep; woken blocks displaced >~1.1m score once and pay coins;
settled scored rubble fades out after ~6s. Awake-body budget 420, instanced
block pool 2600 (one InstancedMesh, zero-scale = free slot).

## Economy

`wreck_*` localStorage: coins, best, owned, equip. Slots: ball / chain /
engine / winch. Earned-only coins — never real money. Ball or chain changes
rebuild the rig (`buildRig()`).

## Testing

`window.__dbg`: `snapshot()`, `stepN(n)` (sync fast-forward), `auto`
(bot ctrl override `{throttle, steer, slew, winch}`), `terrainProbe()`,
`lotAt`, `rig`, `errors`. Drive headless via the scratchpad `drive.mjs` CDP
harness (`--url http://localhost:8765/apps/wreck/index.html`). Gamepad is
testable by stubbing `navigator.getGamepads` (leave ≥2 frames between
press/release so edges are sampled). Icons regenerate from `gen-icon.html`
(canvas → toDataURL, see git history for the harness one-liner).

## Known limitations

- No floating-origin rebase: f32 physics/rendering degrade very far out
  (~tens of km). A single session drive is fine; revisit if anyone marathons.
- `orientation: landscape` in the manifest is honored by Android only; iOS
  shows the CSS "rotate your phone" gate in portrait instead.
