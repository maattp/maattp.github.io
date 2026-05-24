# Kart — Vision & Extension Plan

This is the forward-looking design note for the Kart app. Milestone 1 (single-player
driving feel) is built; this doc captures **how the codebase is meant to grow** toward
the full goal: a 4-player, browser-based kart racer with multiple characters, kart
types, and maps, eventually playable peer-to-peer online with no install.

It is intentionally opinionated about *order* and *seams* so future work lands on the
existing architecture instead of fighting it.

---

## Guiding principles (do not break these)

These are the decisions that are expensive to retrofit, so they were made up front and
should be preserved:

1. **The simulation is a pure function of `(state, input) -> state`.** Everything in
   `simulation/` stays free of Three.js, the DOM, and input devices. This is what lets
   the same step run on a remote authoritative host unchanged.
2. **Fixed-timestep simulation (60 Hz), decoupled from rendering.** Render interpolates
   between the last two sim states. Multiplayer prediction/reconciliation depends on
   this.
3. **Inputs and state are small, flat, serializable plain objects.** Input is
   `{ steer, accelerate, brake, drift }`. State is a flat object. Both must stay cheap
   to clone, snapshot, and send over a wire.
4. **The simulation is deterministic.** No randomness in `stepKart` (randomness lives
   only in render-side effects). Keep it that way so host-authoritative netcode and
   replay stay viable.
5. **Content is data, not code.** Tracks are control points + derived geometry. Kart
   types, characters, and maps should follow the same pattern: data objects the engine
   consumes, not bespoke modules.
6. **Keep the layers separate:** `simulation/` (deterministic logic), `render/`
   (Three.js), `input/` (devices), with all tunables in `config.js`.

---

## Current architecture (what we build on)

```
config.js            tunables (TUNING), track + colors + visual counts
simulation/
  kart.js            pure stepKart(state, input, dt, track) — driving model
  track.js           createTrack() — geometry, on-track test, lap progress, wall confine
render/
  scene.js           renderer, sky, lights, shadows, ground
  trackView.js       asphalt, kerbs, walls, banner, cones from a track
  kartView.js        the kart model + visual feel (lean, hop, wheels, glow)
  props.js           trees, hills, clouds
  effects.js         drift smoke, skid marks, sparks
  chaseCamera.js     smoothed chase cam
  postprocessing.js  bloom + grade
  materials.js       shared toon materials
input/
  input.js           keyboard + touch -> input struct
hud.js               speed, drift charge, laps, countdown, results
main.js              wiring + fixed-timestep loop + race/lap state machine
```

**Solid foundations already in place:** fixed-timestep loop with interpolation, a pure
deterministic `stepKart`, serializable input/state, data-driven track geometry
(samples, edges, walls, lap progress, `confine`), and clean layer separation.

**Known single-entity assumptions to unwind:** `main.js` holds one kart
(`game.curr`/`game.prev`); lap tracking, camera, HUD, and the render path all assume a
single kart. `createTrack()` reads one module-level `TRACK`. There is one `startPose`,
no kart-vs-kart collision, and global (not per-type) `TUNING`/`COLORS`.

---

## Roadmap

Ordered roughly by dependency. The single most important refactor is **#2 (N karts)** —
doing it before AI and online makes both far cleaner.

### 1. Multiple tracks / maps — *small*

- **Now:** `createTrack()` reads the single `TRACK` object from `config.js`.
- **Add:** make it `createTrack(trackDef)`; move track definitions into a registry
  (e.g. `simulation/tracks/*.js` or a `TRACKS` map) each exporting control points,
  half-width, wall width, theme colors, and prop density. Add a track-select screen.
- **Also needs:** a **start grid** — a list of staggered spawn poses derived from the
  start line, instead of today's single `startPose`.
- **Touch points:** `config.js`, `simulation/track.js`, `render/trackView.js`
  (already parameterized by a track object), `render/props.js`, `main.js`, `hud.js`.

### 2. Multiple karts / players (local) — *the big refactor*

- **Now:** the game shell is single-entity.
- **Add:** an array of kart entities, each `{ state, input source, view }`. Step every
  kart through the same `stepKart`. Generalize lap tracking to per-entity, decide the
  camera target (player's kart), and have the HUD show position (1st/2nd/…).
- **Touch points:** `main.js` (entity list + loop), lap tracking, `render/kartView.js`
  (one instance per kart), `render/effects.js` (per-kart emitters), `hud.js`.
- **Why first:** netcode and AI both assume N karts. Retrofitting N-karts during those
  is much more painful than before.

### 3. Kart-vs-kart collision — *medium, new physics*

- **Now:** only kart-vs-wall (`track.confine`).
- **Add:** circle-vs-circle resolution between karts in the simulation (push-apart +
  momentum exchange), staying deterministic and order-independent. Add `kartRadius`
  (already a tuning constant) to the contact test.
- **Touch points:** `simulation/` (a new collision pass over the entity list), `config.js`.

### 4. Characters & kart types — *small–medium*

- **Now:** one global `TUNING`, one global `COLORS`, one fixed model in `kartView.js`.
- **Add:** kart-type stat profiles (top speed, accel, grip, turn, drift, weight) that
  override base `TUNING` per entity, and character/livery data (colors, driver) the
  `KartView` reads. Keep the stats in the pure sim so they affect handling identically
  on a host.
- **Touch points:** `config.js` (profiles), `simulation/kart.js` (read per-kart tuning),
  `render/kartView.js` (parameterized model/colors), a select screen.

### 5. AI opponents — *small, already feasible*

- **Now:** nothing, but the seam exists — AI just needs to emit the input struct.
- **Add:** an AI "input source" that steers toward the track racing line (the centerline
  samples / lap progress are a ready-made path), brakes for tight corners, and drifts on
  sweepers. Difficulty = lookahead + tuning.
- **Touch points:** new `simulation/ai.js` (pure: `(state, track) -> input`), wired as
  an entity's input source in `main.js`.

### 6. Online multiplayer (WebRTC, host-authoritative) — *large, well-seeded*

- **Now:** foundations only (deterministic pure sim, serializable I/O, interpolation
  buffer).
- **Add, in layers:**
  - **Transport/lobby:** WebRTC data channels, room codes, host election. (No server;
    host is authoritative.)
  - **Snapshot protocol:** host serializes the entity states each tick; clients receive
    and interpolate remote karts (the prev/curr interpolation already models this).
  - **Client prediction + reconciliation for the local kart:** keep an **input/state
    history ring buffer** (today we keep only two frames), predict locally, and on each
    authoritative snapshot snap + **replay** pending inputs through `stepKart`. The pure
    function makes replay trivial — the normally-hard part is already handled.
  - **Clock sync** and lag compensation tuning.
- **Touch points:** new `net/` module, `main.js` loop (predict/reconcile), a small
  history buffer alongside `game.curr/prev`. The simulation itself should need **no**
  changes if principles 1–4 hold.

---

## Suggested order of work

1. **N-kart refactor (#2)** — unlocks everything else.
2. **Track registry + start grid (#1)** — cheap, makes testing N karts more fun.
3. **Kart-vs-kart collision (#3)** and **AI (#5)** — gives a real single-player race
   against bots, fully offline.
4. **Characters / kart types (#4)** — content breadth once the systems exist.
5. **Online (#6)** — last, on top of a proven N-kart deterministic sim.

This way there's a complete, fun, offline 4-kart race (player + AI) **before** any
networking risk, and the netcode slots onto a stable base.

---

## Open questions / risks

- **Determinism for online:** host-authoritative doesn't require cross-machine bit
  determinism, but reconciliation replay does require the sim to be deterministic on a
  single machine across replays — keep `stepKart` free of `Date.now`, `Math.random`, and
  frame-rate-dependent shortcuts.
- **Mobile performance with 4 karts + effects + shadows:** budget early; the tier system
  in `main.js` is the place to scale particle counts, shadow map size, and prop density.
- **Item system (shells/boxes), sound, and real art** are deliberately out of scope here
  and should each get their own milestone.
- **Track authoring:** as tracks multiply, an offline validation pass (no ribbon
  self-overlap, turn radius vs wall radius) should become a small reusable script rather
  than ad-hoc checks.
