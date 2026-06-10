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

The full multiplayer plan (private rooms + matchmaking on the Cloudflare
worker, WebRTC with relay fallback, host-authoritative state sync, voice
stretch goal) lives in **`VISION.md`** — read it before starting any netcode
work, and don't regress these four seams.

### M1 netcode (SHIPPED): rooms + WS relay racing

- `net.mode ∈ solo|host|client`. The worker's `Kart3Room` DO (see
  `worker/CLAUDE.md`) is lobby + opaque relay. Humans fill kart slots in
  roster order, AI fill the rest (`buildKartsRoster`).
- **Host** = full authoritative sim; remote humans drive via
  `remoteController` (latest relayed input; `f` is a cumulative fire counter
  so taps survive packet loss). Snapshots every `SNAP_EVERY` ticks from
  `hostSendSnap` (karts compact-array + box flags + goo/rocket positions).
- **Client** sims ONLY its own kart (prediction) in `netClientFrame`;
  everything else interpolates `INTERP_MS` in the past between buffered
  snapshots (`clientApplySnaps`). Own kart adopts authoritative event/item
  fields (bonk/goo/shield/item/rank/finished) and gets gentle position
  correction (>5u ease, >30u snap). Items/boxes/lap-finishes are
  host-decided on clients; goo/rockets render as pooled "ghost" meshes.
- Disconnected humans convert to AI on the host; host-left ends the race;
  results' RACE AGAIN becomes BACK TO LOBBY (DO phase → lobby).
- No pausing online (pause button hidden, visibilitychange guard).
- **Testing**: `wrangler dev` + `python3 -m http.server 8765` serving the
  debug copy from /tmp (must be http://localhost, NOT file:// — the WS
  route checks Origin) + TWO headless Chrome instances (ports 9223/9224 —
  separate instances, one per player, avoids occluded-tab rAF throttling;
  launch Chrome with `--disable-background-timer-throttling`). Autopilot
  both players and drive the lobby via DOM clicks. The client autopilot
  works because input packets carry `player.ctrl` (controller output), not
  raw touch state.
- Known M1 limitation for M2: client steering reaches the host ~50-150ms
  late, so the host's copy of a client kart corners on stale inputs and
  scrubs speed the local player never sees. Candidates: client-authoritative
  own-kart pose in input packets (fine at this trust level), or host-side
  input delay buffering. Also: no client rocket-start (host can't see
  pre-GO inputs), no late-join.

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
  makes elevation possible with no voids (kart2 had to stay flat).
  `terrainY(x, z)` is the same function used for scenery placement.
  **Through the tunnel range the heightfield stays at road level** — the
  headland is a separate rock-shell mesh (bigger arch over the tube + end
  facades connecting shell rim to tube mouth). When the heightfield itself
  ramped up to "cover" the tunnel, the ramp was a solid wall right inside
  the portal mouth (the original "tunnel entrance looks solid" bug).
- **Road decals** (start line, boost pads) are ribbon strips via
  `buildDecalStrip()` that follow `roadY()` bank+slope per sample. Flat
  rotated planes sink/float — the start line vanished into the banked
  chicane (bankSlope at seg 0 is ≈ −0.13).
- Road/curb ribbons are `side: THREE.DoubleSide` (winding faces down).
- Guardrails only where `roadY − terrainY(±(HALF_W+26)) > 4.5` (cliff drops).
- Scenery (palms/rocks/stands/rails-posts/flags…) is baked via `bakeMerge()`
  into ONE vertex-colored mesh (single draw call). Kart bodies likewise: ~45
  primitives baked per kart; wheels are separate meshes (front pivots steer).

## Handling / tuning model (post bug-fix pass)

- Karts have **no lateral slip**: cornering is purely yaw rate vs speed.
  Yaw authority = `TURN_BASE·(1 − TURN_FADE·v/MAX_SPEED)`, so hairpins
  demand braking or drifting (drift turns ~1.2–1.6× tighter).
- `cornerCap[]` is the closed-form solve of `v·κ = margin·yaw(v)` — it MUST
  be derived from the steering model above. (It was once a made-up grip
  formula; the AI braked to ~50 where anyone corners at 90 and "always lost".)
- Acceleration tapers toward the cap (`ACCEL`, `ACCEL_TAPER`): ~4.5s of
  wind-up to top speed, MK64-style. Boosts: floor `BOOST_FLOOR`, cap
  `BOOST_CAP` ≈ 1.5× MAX — not warp speed.
- AI seek boost pads, drift deliberately into braking corners, and have a
  tight skill band (0.955–1.04) — tune pace via autopilot lap times
  (leader ~22–24s/lap; autopilot avg-skill player should finish mid-pack).

## Gameplay conventions (several are explicit user preferences)

- **No spinouts, ever.** Hits = `bonkKart` (speed cut + hop, steering kept).
  Goo slows + wobbles but never removes control.
- Player starts 8th; rank-weighted items (leader pool is defense-only,
  global 30s `zapTimer` cooldown keeps ⚡ rare).
- **Item roulette is tap-to-stop** (player roll 2.2s, AI 1.0s): the first
  `ctrl.fire` while `itemRolling > 0` calls `finishRoll` (locks the item),
  the next one uses it. The item button dedupes `touchstart` + iOS's
  synthetic `click` (one tap must be exactly one fire event, else it stops
  AND instantly uses).
- AI swerve to grab an item box when empty-handed (`b.lat` per box) and
  aim for boost pads.
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
