# Fable Kart 3D — CLAUDE.md

The **true-3D successor engine** to `apps/fablekart/` (see `apps/fablekart/3D-SCOPE.md`
for the founding brief). A single self-contained `index.html`, Three.js **r128**
from cdnjs, landscape iPhone PWA. **Do not modify `apps/fablekart/`** — the two
apps ship side by side deliberately.

## ⚠ Version bump — EVERY PR

Increment `APP_VER` in `index.html` once per PR (shown bottom-right on the menu).

## What replaces the old engine's five limits

| Old limit (fablekart) | This engine |
|---|---|
| One closed centerline ribbon | **Directed graph of spline edges** (`ND` nodes + `EDGE_DEFS`): forks, merges, any number of routes |
| Single-valued heightfield | **3D surface query** (`roadSurface`): XZ spatial hash + Y-window, so stacked roads coexist freely |
| Kart rail-clamped to road | **Drivable terrain** (`terrainY` analytic heightfield, carved to road edges; off-road = slow, not walled) |
| Flat motion + cosmetic tilt | **Surface-plane vehicle**: fwd vector projected onto surface plane, steering rotates around surface normal, physical pitch/roll |
| Slope-free speed | **Gravity mechanic**: `SLOPE_ACC` pull (downhill raises the cap via `DOWNHILL_BONUS`, uphill drains ×`UPHILL_MUL`), ballistic air (`GRAV`) |

## Track: "Summit Run" (one showcase map)

`start` (valley straight, grid + finish line at `LINE_S`) → fork **F** →
`long` (lakeside horseshoe) *or* `short` (steep dirt saddle, ~215u shorter,
narrow) → merge **M** → `climb` (wrap-around mountain ascent to y=70) →
summit crest-jump wedge (`jumpAtStart` raises desc samples 4–12) →
`desc`: fast upper run, **360° helix around a rock spire (crosses over
itself)**, **viaduct over the start straight**, valley run home. Lap ≈ 3700u
(~50s). The upper run also bridges the helix exit leg — three over/unders total.

### Progress / laps / ranking (route-robust)

- Each edge has `remAtEnd` (reverse-graph min distance to the finish line).
  `progress = (lap-1)·lapRef + (lapRef − rem)`; rem uses the kart's actual
  route, so shortcut takers rank correctly. Progress is **ratcheted per lap**
  (reset on respawn via `_progReset`) so re-projections never walk rank back.
- **Gates**: entering a fork route sets gate 0, `climb` gate 1, `desc` gate 2
  (`edge.gate`, granted on edge *transition* only — cutting terrain between
  edges earns no gate, so laps can't be exploited). Line crossing counts only
  with all gates → then `gateMask` resets.
- Kart edge tracking: windowed projection on the current edge (±14 samples,
  Y-weighted); at edge end, transition to nearest outgoing edge (3D distance —
  stacked options can't confuse it); AI override via `plannedNext` (any kart
  with `k.ai`, including the autopiloted player).

### Multi-level rules

- `markElevated()`: a sample is a **bridge** ONLY where it passes >9u above
  another road within 16u XZ (auto-detected incl. same-edge, |Δsample|>40;
  dilated ±12). Everything else is ground road: `terrainY` carves terrain up
  to the road bed (34u apron embankments — the fablekart approach).
- Elevated runs get deck skirts/undersides (`buildDeckBox`), pillars (skipped
  when they'd land on a road below), and guardrails.
- Collisions, and any future item/hazard checks, must Y-gate: karts >4u apart
  vertically never interact (verified: stacked karts at the viaduct, 0 drift).

## Preserved fablekart DNA (don't regress)

- Tuning constants ported verbatim: SIM_DT 1/60, MAX_SPEED 92, ACCEL 48/0.55,
  BOOST_CAP 138, TURN_BASE 2.4/FADE 0.28, MKDS drift (engage |steer|>0.28,
  ramp dt·3.2, counter-steer band 0.18–1.10, mini-turbos 8/12/16 → caps
  116/122/126 via `grantBoost` one-shot kicks — **no per-tick speed floor**).
- **Steering default is the deliberately inverted mapping** `(touch+key)*-1`
  (family playtest, fablekart PR #170). Do NOT "fix" it.
- No spinouts: `bonkKart` = speed cut + hop, steering kept.
- The four multiplayer seams: seeded mulberry32 (`seedRng`; `vrand` for
  cosmetics only), controller abstraction (`k.ctrl`), fixed-step numbered sim
  (`simTick`/`simTickNo`, accumulator + hitch guard), and
  `netSnapshot()`/`netRestore()` (round-trip verified exact). No netcode yet —
  solo-first per the brief (§4); when it lands, use a fresh worker namespace.
- Render interpolation: karts/camera blend prev↔cur sim pose by `simAcc/SIM_DT`
  (ProMotion vibration lesson), `frameLerp` for dt-normalized visual lerps.
- HUD layout: bottom-LEFT quadrant stays EMPTY (steering thumb zone).

## AI notes

- `cornerCap` derived from the steering model (closed form, `CC_M = 0.93·TURN_BASE`).
  **Bank bonus is only 1 + |bank|·0.25** — this engine has no bank-grip assist;
  a bigger bonus sends AI off the helix. Downhill corners get an extra
  `1 − clamp(−ty·2.2, 0, 0.35)` cap discount (longer braking under gravity).
- Route choice at forks: per-race seeded `ai.daring` > 0.52 → shortcut.

## ⚠ Verify by rendering, not by reading

Same rule as fablekart. Harness recipe (session scripts in scratchpad
`k3d/`; recreate from this): `prep.js` injects `window.__dbg` at the
`/*__DBG_HOOK__*/` comment (before the startBtn listener) exposing
scene/karts/track/terrainY/roadSurface/controllers/snapshot + `__dbg.freeCam()`;
launch Chrome `--headless=new --use-gl=angle --use-angle=swiftshader
--enable-unsafe-swiftshader --remote-debugging-port=9223`; drive over CDP.
`K3D_LAPS=1 node prep.js` patches TOTAL_LAPS. Autopilot the player with
`p.ai = {...daring: 0|1...}; p.controller = __dbg.aiController` and probe both
routes: gravity (desc max speed >100), air time at the crest, gates 1→3→7,
lap increment, progress monotonic (dips only with respawns), snapshot
round-trip exact, stacked-kart isolation. SwiftShader renders pastel/washed —
judge colors on device, geometry headless.

## Known rough edges (v1)

- Terrain carve walls between helix windings are steep smeared cliffs (grid
  8u); acceptable stylistically, could use a finer local mesh later.
- Lake is a flat disc at y=0.25; shoreline slices terrain bumps at the rim.
- Guardrails are cosmetic only (no physics wall — off-road is legal recovery).
- No items/boxes yet (M4), one map, no settings pane, difficulty fixed medium.
