# Kart 3 — CLAUDE.md

Project notes for **Kart 3** (`apps/kart3/index.html`). Read before changing it.
Repo-root `CLAUDE.md` covers site-wide rules; `apps/kart2/CLAUDE.md` documents
the headless render harness in depth and several lessons this app inherits.

## What this is

A single self-contained `index.html` — a **landscape** (horizontal) 3D kart
racer for iPhone PWA. Three.js **r128** from cdnjs, all assets generated at
runtime. One map ("Coral Cliffs Circuit"), 3 laps, player + **7 AI**.
Left-thumb slide steering, DRIFT/ITEM buttons, auto-accelerate.

## ⚠ Verify by rendering, not by reading

Same rule as Kart 2: for any visual/physics change, run the headless harness
and look at pixels + probe numbers. Pattern (scripts live in `/tmp/kart3dbg/`
during a session; recreate from this recipe):

1. `prep.js` copies `index.html` and injects `window.__dbg = {...}` right
   before `dom.startBtn.addEventListener('click', startGame);` exposing
   scene/camera/karts/track arrays/`netSnapshot`/`aiController`.
2. Launch local Chrome: `--headless=new --use-gl=angle --use-angle=swiftshader
   --enable-unsafe-swiftshader --remote-debugging-port=9223 --user-data-dir=/tmp/...`
3. Drive over CDP from node (global fetch + WebSocket): navigate to the
   `file://` debug copy, `Runtime.evaluate`, `Page.captureScreenshot`.
4. **Autopilot the player** for gameplay tests:
   `p = __dbg.player(); p.ai = {skill:1, aggr:0.6, drift:0.8, driftHold:1.5,
   phase:0, laneBias:0, errT:6, errOff:0, rival:false}; p.controller = __dbg.aiController;`
5. For full-race tests patch `TOTAL_LAPS = 1` in the debug copy.

**SwiftShader caveat:** Lambert + bright lights renders washed-out pastels
headless; the lighting values are kart2-proven on the real iPhone. Force
MeshBasicMaterial to separate real geometry bugs from SwiftShader shading
artifacts. Audio is inaudible in CI — code-review it.

## Architecture (one IIFE)

config → track math → terrain/world build → particles → kart meshes →
race state → physics → items → AI → collisions → camera → HUD/minimap →
audio/music → input → menu → flow → fixed-step sim + render loop → boot.

### Multiplayer-readiness seams (no netcode yet — deliberate)

1. **Seeded PRNG** (`seedRng`/`rng`/`rand`/`pick` = mulberry32). World builds
   from fixed `WORLD_SEED`; each race reseeds from `raceSeed`. Cosmetic
   particle randomness uses `vrand`/`vpick` (Math.random) so it can't desync.
2. **Controllers**: physics reads only `k.ctrl {steer, brake, drift, fire}`.
   `localController` (touch/keys) and `aiController` are interchangeable; a
   future remote peer is just a controller fed from packets. Player item use
   flows through `pendingFire` → `ctrl.fire`, consumed in the sim tick.
3. **Fixed-step sim**: `simTick(SIM_DT=1/60)` via accumulator, numbered ticks
   (`simTickNo`). Everything gameplay-mutable updates there; camera/HUD/audio/
   particles update per render frame.
4. **`netSnapshot()` / `netRestore()`**: full race-state serialization
   (verified exact round-trip in the harness).

To add WiFi multiplayer one day: transport (WebRTC data channel or WS via the
Cloudflare worker), host broadcasts `{raceSeed, roster}` + input packets or
periodic `netSnapshot`s; remote karts get a packet-fed controller.

## Track / world model

- `CTRL` points `[x, z, y]` are scaled by `SC = 1.35`; elevation 0→31.
  Tunnel portals + jump location are found by `nearestSeg()` from landmark
  coords at build.
- `centerline/tangents/normals` (N=820): tangents from **finite differences**,
  never `curve.getTangentAt()` (closed-curve seam glitch — kart2's bowtie bug).
- **Banking**: `bankSlope[i]` from smoothed signed curvature; θ increasing
  bends toward −n so outer edge (+n) is higher with the same sign. Road/curbs/
  kart `groundY` all use `roadY(i, lateral)`.
- **Jump**: a 4.6-high wedge carved into the (descending) elevation right at
  `jumpSeg`; vertical physics (`k.y/k.vy/grounded`, launch when ground drops
  faster than `vr < -30`) does the rest. The wedge must out-climb the descent
  or the jump feels flat.
- **Terrain**: 128² heightfield; each vertex blends from road-edge height
  (embankment) to noise hills by distance from the centerline — this is what
  makes elevation possible with no voids (kart2 had to stay flat). Over the
  tunnel range the blend target is `centerline.y + 15` (the headland).
  `terrainY(x, z)` is the same function used for scenery placement.
- Road/curb ribbons are `side: THREE.DoubleSide` (winding faces down).
- Guardrails only where `roadY − terrainY(±(HALF_W+26)) > 4.5` (cliff drops).
- Scenery (palms/rocks/stands/rails-posts/flags…) is baked via `bakeMerge()`
  into ONE vertex-colored mesh (single draw call). Kart bodies likewise: ~45
  primitives baked per kart; wheels are separate meshes (front pivots steer).

## Gameplay conventions (several are explicit user preferences)

- **No spinouts, ever.** Hits = `bonkKart` (speed cut + hop, steering kept).
  Goo slows + wobbles but never removes control.
- Player starts 8th; rank-weighted items (leader pool is defense-only,
  global 30s `zapTimer` cooldown keeps ⚡ rare).
- Rubber band is bounded (±10%, ±7% on the final lap), two 'rival' AI shadow
  the player, AI block chasers and make late-brake mistakes. AI obey the same
  physics caps as the player (`_rubber` is the only asymmetry).
- Drift only engages while actually steering (|steer| > 0.28); hold DRIFT on
  GO! for a rocket start.
- Lap counting: forward seam crossing (prev seg > 0.7N → new seg < 0.25N);
  grid starts just *past* the line.

## Verification checklist before shipping

1. `node -e "new Function(<inline script>)"` syntax check.
2. Headless: menu + free-camera shots (top-down, start line, banked bend,
   tunnel, jump) + autopilot race with screenshots; capture `Runtime.exceptionThrown`.
3. Full 1-lap race → results screen, 8 standings rows, race-again works.
4. Jump probe: player goes airborne (grounded=false) near `jumpSeg` with a
   rising arc.
5. Honest PR notes: no GPU, no audio, no touch in CI.
