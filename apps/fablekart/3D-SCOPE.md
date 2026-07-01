# Fable Kart → True 3D — Full-Rewrite Proposal

**This is a build brief for a fresh, more capable session.** It proposes the
*ambitious* path: a ground-up rewrite of the movement, track, terrain, and
progress systems into a **true 3D kart engine with no track limitations** —
branching shortcuts, roads that freely cross over and under each other, mountains
you climb and descend, and gravity that genuinely accelerates you downhill. It
fully realizes the "it should feel 3D, not 2.5D" vision instead of retrofitting
the current engine.

**On purpose, this document says WHY the current limits exist and WHAT we want to
achieve — but not HOW to build it.** The implementing session is expected to
reason through the actual architecture and mechanisms itself. Treat the goals
below as the contract; treat any design decision as yours to make.

**Ship it as a NEW app so the two can be tested side by side.** Do **not** modify
`apps/fablekart/` — create `apps/fablekart3d/` (see §6). The current game stays the
stable, shippable racer; the new app is the 3D engine under development. Register
`fablekart3d` in the launcher (`apps/index.html`) so it's reachable on device.

> Everything below assumes the reader has NOT seen the current codebase. §1 gives
> the context and the reasons behind today's limits; §2 states the goals to hit.

---

## 0. The vision — what "no track limitations" means

A racer where the **track is real 3D geometry**, not a painted ribbon:

- **Shortcuts & branches.** The course forks and merges. A daring line through a
  cave or off a cliff-edge ramp rejoins later and is genuinely shorter. Multiple
  valid routes, each with its own risk/reward.
- **Free crossovers.** Roads pass over *and* under each other anywhere, any number
  of times — spirals, stacked interchanges, a bridge over a bridge. No "one clean
  overpass" limit.
- **Mountains.** You climb real elevation and descend it. Long descents build
  dangerous speed; climbs bleed it. Verticality is a core mechanic, not scenery.
- **Gravity that matters.** Downhill accelerates you past normal top speed (into
  the risk of overcooking the next corner); uphill saps you; jumps and drops are
  ballistic. The kart sits *planted* on whatever slope it's on.
- **Drive-anywhere feel.** The world is drivable surface, not a corridor you're
  rail-clamped inside. You can cut wide, take a mountainside line, catch air off
  terrain — within reason. The *playable* surface is broad and multi-level, not a
  narrow tube, while still reading as a race course rather than an aimless sandbox.

The current engine can *look* like this in screenshots but is architecturally a
single 1-D loop with a single-height ground. This proposal replaces that core.

---

## 1. Context: what the current engine is, and why it caps out

`apps/fablekart/index.html` is a single self-contained IIFE — Three.js **r128**,
all assets generated at runtime, an iPhone-PWA landscape kart racer with 8 tracks,
7 AI, drift/items, and **shipped host-authoritative online multiplayer** (WS relay
+ WebRTC, seeded-deterministic). It is genuinely good and worth reading for the
physics-feel, AI, item, audio, and netcode work — **keep all of that** (see §5).
What it *can't* do is topology.

It caps out at "2.5D" because of five deliberate design choices. Understanding
*why each exists* matters — each was a reasonable trade that bought simplicity,
determinism, or performance, and each is now the thing blocking the vision:

- **A. The whole track is one closed centerline ribbon.** A per-track control-point
  loop becomes a single sampled curve, and *everything* downstream — lap counting,
  ranking, the lateral walls that keep you on road, the AI racing line, the
  minimap, and the network progress field — is defined as "how far along this one
  loop am I." **Why it exists:** one ordered loop makes progress, laps, ranking,
  and AI pathing trivial and unambiguous. **Why it blocks us:** there is no way to
  express a fork, a merge, or a second route — the code's own comments note that a
  true branch would break progress, the wall clamp, AI, and the minimap
  simultaneously. This is the #1 blocker for **shortcuts**.
- **B. The ground is a single-valued height map** — one height per (x,z) location.
  Overpasses today are a special-case hack that supports exactly one clean
  crossover. **Why it exists:** a single height lookup is cheap and simple, and
  most tracks are single-level. **Why it blocks us:** two surfaces can't occupy the
  same (x,z), so spirals, stacked interchanges, or a road through a mountain are
  impossible. This is the #1 blocker for **free over/unders**.
- **C. The kart drives on the road, not on the terrain.** The surface under a kart
  is derived from its position on the ribbon; the visible mountains and terrain are
  scenery the kart is walled off from ever touching. **Why it exists:** it
  guarantees the kart is always cleanly "on track." **Why it blocks us:** there is
  no concept of resting on arbitrary ground, so "drive up that mountain" has no
  meaning today.
- **D. Motion is flat-plane with cosmetic tilt.** The kart moves in 2D (heading +
  speed) with a separate height value bolted on for jumps; its pitch and roll are
  *visual only* and don't affect physics. **Why it exists:** 2D motion is stable,
  predictable, easy to tune, and easy to keep deterministic across the network.
  **Why it blocks us:** there's no true surface orientation, so the kart can't sit
  planted on a slope, bank through elevation, or behave like a body on 3D terrain.
- **E. Slope doesn't affect speed.** Speed comes purely from acceleration toward a
  cap; elevation never adds or removes energy. **Why it exists:** simplicity and
  predictable tuning. **Why it blocks us:** this is the literal reason hills feel
  flat — going downhill doesn't speed you up. It's the #1 blocker for **gravity
  that matters**.

**The rewrite is free to replace all of A–E.** Everything else the game does well
is portable and should be carried over, not reinvented (§5).

---

## 2. Goals for the new engine (the contract — mechanisms are yours to choose)

Each goal below is a capability the new app must deliver. *How* you represent the
track, resolve surfaces, model the vehicle, track progress, or sync state is left
to you — reason it through against these outcomes, the risks in §3, and the feel of
the current game.

1. **Branching topology.** The course can fork and merge, with more than one valid
   route between two points, and shortcuts that are genuinely shorter. Laps,
   ranking, AI, and the map must all stay correct across every route.
2. **Correct progress on any route.** A robust lap/position system that works when
   players take different branches — no false laps, no exploitable shortcuts,
   fair ranking between karts on different paths.
3. **Multi-level world.** Roads and terrain can overlap in plan view: over/unders,
   stacked interchanges, spirals, roads through mountains — any number of times,
   not a single special case.
4. **Real drivable terrain.** The kart rests on and drives across actual 3D
   surface (roads *and* terrain/mountains), not a corridor it's rail-clamped
   inside. Leaving the playable surface recovers gracefully rather than being
   prevented by an invisible wall.
5. **True 3D vehicle.** The kart is oriented to the surface it's on — pitch and
   roll are physical, it sits planted on slopes, steers and banks believably
   through elevation, and goes ballistic off jumps and drops.
6. **Gravity as a mechanic.** Descending builds speed (with real risk into the next
   corner); climbing costs speed; air time is genuine ballistics. This should be a
   central part of how the game feels, not a cosmetic touch.
7. **A camera that sells verticality.** The view conveys climbs, descents, drops,
   and banking clearly without clipping or disorientation, while keeping the
   current game's tight, punchy chase feel.
8. **AI that races the real course.** Opponents choose routes (including whether to
   take a shortcut), carry speed correctly over elevation, and remain competitive —
   preserving today's skill-band / rubber-band / difficulty behavior on top of
   whatever navigation you build.
9. **Preserve the feel.** The moment-to-moment driving, drifting, boosting, item
   play, and no-spinout philosophy should feel like a Fable Kart game — the
   substrate changes, the character doesn't.

---

## 3. Risks & hard parts the session must reason about

These are the places this rewrite most easily goes wrong. The brief does not
prescribe solutions — but a credible design has to have an answer for each:

- **iOS Safari performance at 60 Hz.** Richer 3D geometry and per-kart surface
  work across 8 karts is the main risk. The current game's discipline (minimal
  draw calls, baked geometry, generated assets) is the bar. Verify on a real
  iPhone early, not only headless.
- **Determinism for multiplayer.** Online is host-authoritative *state sync* (not
  lockstep), so it tolerates some drift — but the simulation must stay fixed-step
  and reproducible enough that snapshots remain meaningful. 3D physics and
  orientation math make this harder than the current 2D motion.
- **Progress robustness where routes overlap.** Forks, merges, and stacked roads
  are the classic source of "which part of the track am I on" bugs. Ambiguity here
  corrupts laps and ranking — it needs a deliberate, tested answer.
- **"Drive anywhere" vs. "it's a race."** A fully open world fights lap structure
  and fairness. The playable surface should feel broad and multi-level yet still be
  a bounded, legible race course.
- **Content authoring cost.** A branching, multi-level, mountainous course is far
  more to author than today's control-point loop. Build ONE showcase track that
  exercises every capability (fork + merge, over/under, a spiral, a mountain climb
  and a fast descent, a tunnel) before porting or reimagining the existing eight.
- **Re-proving the verification harness.** The whole project is verified by
  *rendering, not reading* — a headless render + autopilot + numeric-probe
  workflow. Stand that up for the new app first, and treat performance as a
  first-class thing to measure.

---

## 4. Multiplayer — preserve the seams, let the state grow

The current game's online stack is a real asset and the right model
(host-authoritative state sync, WebRTC with relay fallback, seeded determinism).
It rests on four seams that the new engine should **keep**: deterministic seeded
randomness, a controller abstraction (a remote player is just another input
source), a fixed-step numbered simulation, and full race-state serialization for
snapshots and rejoin. A version gate already refuses to pair mismatched builds.

What necessarily *grows* in a 3D world — a richer pose (full orientation, not just
a heading) and a route-aware progress representation — is a consequence of the
goals in §2; how to encode and reconcile it is yours to decide. **Recommended
sequencing:** build and stabilize the engine **solo-first**, then re-layer netcode
once movement, terrain, and progress are solid. The seams make that re-layering
tractable; doing both at once is the trap.

---

## 5. What to carry over (don't reinvent the good parts)

From `apps/fablekart/index.html`, port the *design and feel*, re-fit to whatever
new substrate you build: kart handling and tuning philosophy, the drift model,
boost mechanics, the full item set and roulette, the no-spinout bonk rule, the
rubber-band + AI skill/difficulty system, the audio/music engine (per-track
sequenced compositions), the HUD/standings/minimap layout, the menu/lobby flow,
the four multiplayer seams, and the iOS-PWA patterns. Read that file's `CLAUDE.md`
and `VISION.md` for the hard-won lessons (headless-shading caveats, high-refresh
render interpolation, determinism traps) — most still apply.

---

## 6. Practical setup for the implementing session

- **New app:** `apps/fablekart3d/index.html` (self-contained, same shape as every
  app here). Optionally add `apps/fablekart3d/CLAUDE.md` + `VISION.md`. A fresh app
  is a chance to move to a newer Three.js if you judge it worthwhile.
- **Do not touch `apps/fablekart/`** — side-by-side testing depends on the current
  game staying exactly as-is.
- **Launcher:** add a `fablekart3d` tile to `apps/index.html` so it opens on device.
- **Clean slate back-end:** this app does not need to reuse the current game's
  worker routes or storage keys. If multiplayer lands, give it its own namespace so
  the two games never collide.
- **Verify by rendering, not reading** (project rule): reproduce the headless
  render + autopilot + numeric-probe harness and check pixels and probe numbers for
  every physics/visual change; verify performance on a real iPhone early.
- **Version bump per PR** (`APP_VER`) as with every app here.

---

## 7. Suggested milestones (capability order, solo-first)

Framed as capabilities to reach, not mechanisms to build — sequence and approach
are yours:

1. **M0 — App skeleton.** `apps/fablekart3d/` boots, PWA meta, headless harness
   reproduced, an empty drivable world with the ported driving feel. In the
   launcher.
2. **M1 — Surface driving + gravity.** True 3D vehicle on real surface: planted on
   slopes, downhill acceleration / uphill drag, ballistic air and landings. One
   mountain to climb and bomb down. *The core "it's 3D now" proof.*
3. **M2 — Branching + progress.** A track with a real shortcut that forks and
   merges, with correct laps and ranking across routes and graceful out-of-bounds
   recovery.
4. **M3 — Free over/unders.** Stacked roads that cross over and under — an
   interchange, then a spiral — with a map that reads the branches/layers.
5. **M4 — AI on the real course.** Route choice, elevation-aware pace, competitive
   racing; port the skill/rubber/difficulty behavior. A full 8-kart solo race that
   feels like a race.
6. **M5 — Content pass.** Polish the showcase track (landmarks, theme, music);
   decide whether to reimagine the existing 8 tracks in 3D or design new ones.
7. **M6 — Multiplayer.** Re-layer online on the stabilized engine; two headless
   clients racing end-to-end. Only after M1–M4 are solid.

Ship M0–M2 as the first testable side-by-side build — that alone demonstrates the
vision (drive up and down real mountains, take a shortcut) next to the current
game. The end state: `apps/fablekart` (the polished 2.5D racer) and
`apps/fablekart3d` (the true-3D successor) live side by side, and the vision —
shortcuts, free over/unders, mountains, real gravity — is fully realized in the
new engine.
