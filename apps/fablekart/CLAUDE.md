# Fable Kart — CLAUDE.md

Project notes for **Fable Kart** (`apps/fablekart/index.html`), formerly
"Kart 3" (renamed 2026-06, named after Claude Fable). The rename is
user-facing only: the worker API routes (`/kart3/rooms`), the `Kart3Room`
DO, and all `kart3_*` localStorage keys deliberately keep their old names —
they're invisible to players and renaming them would risk the multiplayer
backend and wipe saved best times/settings. Read before changing it.
Repo-root `CLAUDE.md` covers site-wide rules; `apps/kart2/CLAUDE.md` documents
the headless render harness in depth and several lessons this app inherits.

## ⚠ Version bump — EVERY PR

**Increment `APP_VER` in `index.html` once per PR.** It is displayed on the
title screen (bottom-right) and is the manual half of `NET_VER`, the online
version gate: two phones only share a room when their tags match, so a
forgotten bump lets a stale build pair with a new one and desync (the hash
half auto-covers track geometry + core physics, but nothing else).

## Offline / service worker (v37)

`sw.js` makes SOLO play fully offline: stale-while-revalidate for the
same-origin shell, cache-first for the pinned Three.js r128 cdnjs URL
(versioned upstream = immutable). Cross-origin requests other than that CDN
script — the multiplayer worker API above all — are deliberately NOT
intercepted, so online play can never hit a stale cache. **Bump `CACHE`
(`fablekart-vN`) alongside APP_VER when a deploy must reach installed
players immediately.** Verified offline via CDP `Network.emulateNetworkConditions`:
menu renders and a full solo race runs with the network hard-off.

Haptics: `vibrate()` falls back to the hidden `<input switch>` toggle hack on
iOS (navigator.vibrate is a silent no-op there — the game's primary platform
had zero haptics until v37); iOS 17.4+ fires the system tick on toggle.

## What this is

A single self-contained `index.html` — a **landscape** (horizontal) 3D kart
racer for iPhone PWA. Three.js **r128** from cdnjs, all assets generated at
runtime. **Eight tracks** (Coral Cliffs, Volcano Bay, Whisper Wood,
Glacier Pass, Neon City, Dust Devil Gulch, Crossover Speedway, Sky Citadel), 3 laps, player + **7 AI**. Left-thumb slide steering,
DRIFT/ITEM buttons, auto-accelerate. Each track has its own composition
(per-track `SONGS` sequencer), signature landmarks, and theme.

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
artifacts. Audio is inaudible in CI — code-review it (per-track music in
`SONGS`: a generic step sequencer reads one composition per track id, so
each has its own tempo/meter/instrumentation — Coral Calypso, Caldera
Run, the 3/4 Elder Waltz, Permafrost; render a song offline through an
`OfflineAudioContext` driven by the live `SONGS` data to actually hear
it). `NOTE` is a generated equal-temperament chromatic table.

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
### M2 netcode (SHIPPED): WebRTC fast path + pose authority + rejoin

- **WebRTC DataChannels** (`rtcInitiate`/`rtcHandleSignal`): host offers one
  unordered/unreliable 'fast' channel per client from the LOBBY (pre-warmed
  before GO); SDP/ICE relayed through the DO (`rtc` messages). Snapshots are
  dual-sent (WS broadcast + every open channel) and clients dedupe by tick —
  fastest transport wins; pairs that can't go P2P just stay on the relay.
  Inputs go rtc-else-ws (`sendToHostFast`). `window.__noRtc` forces relay
  (used in tests).
- **Client-authoritative pose** (fixes M1's stale-steering): input packets
  carry the own-kart pose; on the host, remote karts skip physics entirely
  (`updateRemoteKart`) — pose is lerp-applied, effect timers tick, item
  pickups/laps/ranks stay host-derived, `clampToTrack` sanity-bounds it.
  They're immovable in `resolveCollisions` (owner moves them). The client no
  longer eases toward the host echo (it's just its own delayed pose) — only
  a >45u emergency snap remains. Client rocket-start is back.
  - **GOTCHA — never `Math.max` a round-tripped field on the client.** The
    client sends its own `boostTimer` in the pose; the host echoes it
    (`updateRemoteKart` maxes it in) and broadcasts it. A monotically
    DECREASING field, echoed back a full round-trip stale, is always
    *larger* than the current local value — so `max`ing the snapshot in
    every frame ratcheted boost up forever (permanent-boost bug, fixed
    PR #199). Client now adopts host-granted boosts on their RISING EDGE
    only (`net._lastSnapBoost`) and lets local prediction own the decay.
    Same trap applies to any future predicted-but-echoed timer.
- **Mid-race rejoin**: DO stores `seats` (id+name) at race start; a hello
  during `racing` whose name matches a vacant seat is re-admitted with
  `welcome.rejoin`. Host converts that kart AI→remote and sends a targeted
  `rejoin-state` event (seed + racePlayers + full `netSnapshot`). Clients
  auto-retry 4× on mid-race socket loss (own kart keeps driving, remotes
  freeze on the last snap); cold rejoin (page reload) rebuilds the race and
  `netRestore`s.
- **Connection indicator** (`#netInd`): client shows `P2P/RELAY · Nms`
  (WS RTT via `pp` echo, doubles as keepalive); host shows open-channel
  count. Green when fully P2P.
- **CI caveat**: under SwiftShader CPU contention the host page's sim runs
  slower than wall time (hitch guard drops time) while pose-authoritative
  clients keep real-time speed — host AI and raceClock fall behind. That's
  load distortion, not a netcode bug; quiet machines and real phones at
  60fps don't exhibit it. Run perf-sensitive assertions on a quiet machine.

## Track / world model

- **Multi-track**: `TRACKS[]` holds per-track ctrl loops, tunnel/jump
  landmarks, and a `theme` (EVERY world color lives in the theme — sky,
  fog, terrain palette, road/lane, tunnel, foliage kind 'palms'|'spires',
  embers). `loadTrack(idx)` disposes the `world` Group and rebuilds;
  karts/particles/ghosts live in the scene and survive. World build is
  seeded `WORLD_SEED + idx*7919` so every client builds identical tracks.
  Online: host picks in the lobby (`track` DO message); everyone's menu
  backdrop follows live; `start`/`rejoin-state` carry the index. Best
  times are per-track (`kart3_best_<id>`, legacy key = coral).
- Tracks: **Coral Cliffs** (sunny island, beach/palms, tunnel),
  **Volcano Bay** (dusk caldera — structurally distinct, NO tunnel), and
  **Whisper Wood** (two words — one word clipped the track card; twilight
  forest, the VERTICAL one: rolling whoops → switchback climb → summit
  HORSESHOE around the Elder Tree at 45 high (others top out at 31/33) →
  crest-jump dive past the waterfall → creek-ford chicane. **NO tunnel /
  jumbotron by design** — those are Coral's landmarks (user feedback:
  tracks must not share signatures). Its own landmarks live in
  `buildLandmarks()`, each gated on a theme field like Volcano's crater:
  `elderTree` (colossal trunk + glowing hollows + overhanging canopy +
  lantern-orb spinners + warm PointLight; sits in the terrain hollow
  inside the horseshoe, so it rises from below the road), `waterfall`
  (placement SCANS ±28 segs × both sides for the max terrain drop — a
  fixed offset buried the pool in the embankment; animated curtain via
  `waterfallMats` scroll), `ford` (water-film decal across segs
  `fordA..fordB`; updateKart emits spray while crossing — cosmetic only,
  no speed effect). Theme extras: `fogNear`/`fogFar` overrides (mistier),
  `foliage: 'forest'` (tall stacked-canopy trees, island-wide seeded
  scatter of ~900 so the ridge doesn't read bald, glowing mushroom rings
  via `glowFlora`), `wisps`, `fireflies` (170-point drifting/blinking
  cloud via `fireflyPts`), `stars`. Debug-camera caveat: distant aerials
  sit beyond fogFar and the treed ridge looks bald — judge from
  gameplay-range cameras.):
  - **Caldera rim ride**: ~220° banked arc on the crater crest with a
    glowing lava lake inside (`THEME.crater` shapes the heightfield in
    `hillH`; lake disc + pulsing PointLight + smoke in `buildLava`).
  - **Lava gap**: `gapLen` samples of road MISSING right after the ramp
    (`gapA..gapB`; indices skipped in road/curbs, terrain carved by a
    radial depression — nearest-seg alone gets bridged by the coarse
    grid; lava river ribbon needs DoubleSide, the eternal winding
    lesson). Physics: in-gap ground = `lavaGapY`; landing short →
    `lavaSplash` (respawn before the ramp on STAGGERED lanes — a single
    respawn point caused pile-up splash-loops). Third consecutive splash
    carries you PAST the gap. The approach must stay STRAIGHT for ~60
    samples so AI arrive at full speed (clear threshold ≈ 45).
  - **Eruptions** (`THEME.eruptions`): lava-bomb volleys on the
    0.22-0.72N zone — schedule precomputed at resetRace from the seeded
    rng (first draws after `seedRng(raceSeed)`!) so all online clients
    see identical volleys with zero netcode; warn ring 1.4s → falling
    rock 0.6s → impact bonk r≈6.5. `updateBombs` runs in simTick AND
    netClientFrame.

- **Glacier Pass** (`id: 'glacier'` — night-snow summit, THE HARD ONE).
  Signature systems, all theme-gated in `buildGlacierZones()` and
  measured/resolved from landmarks at load:
  - **Ice physics** (`iceSegs`): steering authority ×0.55 inside zones
    (frozen lake full-width, final chicane, the split's shortcut lane).
    Flag set per-tick in `clampToTrack(k, dt)` — dt is ONLY passed from
    the kart's own sim, so pose-authoritative remote karts are exempt
    (their owner applies zone physics; never "fix" that by passing dt
    from updateRemoteKart).
  - **THE SPLIT** (`splitZone`): a crevasse-median wall divides a long
    bend into two lanes on the SAME ribbon (a true forked centerline
    would break progress/clamp/AI/minimap). Which lane is the shortcut
    is MEASURED at build (inside of the arc, ~20u shorter) and that lane
    is auto-iced + narrowed. Median = wall-style shove in clampToTrack.
    AI lane choice: seeded per-racer "daring" override in aiController
    (without it the racing line sends every AI inside).
  - **Crosswind ridge** (`windZone`): constant lateral push toward
    whichever side the ground drops (resolved at build).
  - Aurora curtains (`auroraMats`, UV-scroll + opacity pulse), falling
    snow (`snowPts`, camera-following recycled point cloud), ski-lift
    gondola (`gondolaAnim`, sagging cable + ping-pong cabins), `pines`
    foliage (snow-capped conifers).
- **Crossover Speedway** (`id: 'speedway'`, `theme.speedway`) — THE 3D ONE:
  a figure-8 motorsport circuit where the ribbon flies OVER itself on a
  viaduct and passes back UNDER. This is the proof-of-concept that the
  engine can do crossovers/flyovers (single ribbon, no forked centerline).
  How the overpass works without breaking the heightfield:
  - **`viaductSegs` (auto-detected)**: after `buildCenterline`, scan every
    seg pair; if two segs are close in XZ (<16u) but far apart in Y (>9u)
    AND >24 segs apart along the ribbon, the HIGH one is a viaduct seg.
    No hand-tagging — re-tune the ctrl loop and the overpass set updates.
  - **`terrainY` exclusion**: under a flyover the single-valued heightfield
    must follow the LOW road, not tent up to the deck. `nearestSegExcl()`
    finds the nearest NON-viaduct seg; `terrainY` uses it whenever the
    plain nearest seg is a viaduct. Deck floats on baked pillars
    (`buildSpeedway`: red box columns from `roadY-1` down to terrain + cap).
  - **Y-aware gameplay gates** (the netcode-relevant fixes): item pickups,
    goo-hazard hits, and `resolveCollisions` all `continue` when `|Δy|`
    between two bodies exceeds ~3-6u, so a kart on the deck can't collide
    with / pick up / get goo'd by one on the road directly below. Verified:
    two karts stacked 8u apart in XZ / 18u in Y do NOT interact.
  - **Netcode survives**: pose already carries Y; progress is windowed +
    incremental (`nearestSegNear`); host item/lap/rank authority unchanged.
    No protocol change was needed for 3D tracks.
  - Other landmarks in `buildSpeedway`: tire-wall barriers (baked cylinders
    on the outside of high-curvature segs), billboards (set-back panels,
    clearance-checked). `foliage:'speedway'` → sparse green shrubs only
    (palms/scatter early-return). Music: `SPEEDWAY_SONG` "Pole Position"
    (E major, four-on-floor, square/saw lead).
- **Sky Citadel** (`id: 'citadel'`, `theme.citadel`) — THE FINALE / "shining
  jewel" (built for Apple-employee feedback that the game needed a grand 8th
  track). A floating castle circuit ABOVE A SEA OF CLOUDS:
  - **Floating ribbon-island terrain**: `hillH` returns the cloud void (-62)
    off the track, so `terrainY`'s road-edge blend turns the circuit into a
    narrow ribbon floating in cloud, with guardrails auto-added by the cliff
    rule. The keep sits on its own raised platform (`THEME.keep`, a bump in
    `hillH`) that overlaps the ribbon's inner verge so it reads as connected.
  - **`buildWater` cloudSea branch** (`theme.cloudSea`): tinted cloud-floor
    discs + a baked billowing cloudbank + golden drifting motes instead of
    water.
  - **`buildCitadel`**: the keep (central donjon + 4 corner towers, all with
    pointed roofs + finial spires CROWNED WITH GLOWING ORBS — the "jewels";
    a dark finial roof read as a black ball backlit, hence the glow), a
    crenellated curtain wall, a gatehouse arch the road drives under (f0.86),
    braziers w/ warm PointLights, pennant poles, decorative floating islands,
    and waterfalls spilling off the ribbon's OUTER edge into the void
    (`waterfallMats` scroll). A **dragon** circles the keep — pushed into the
    `birds` flock array (grp + wl/wr flap); body is a SLIM box + big membrane
    wings (a cylinder body read as a dark ball head-on) and near-self-lit
    (high emissive) so it never renders dark.
  - Theme: luminous twilight sky (lightened `skyTop` — a dark zenith read as
    a dark ball when the cam tilts up), `aurora`, `stars`, drawbridge
    crest-jump on the bottom straight (`jumpAt`). Music: `CITADEL_SONG`
    "Aether Crown" (D major fanfare). **SwiftShader caveat bites hard here**:
    the blown-out near-white sky makes any mid-tone sky object (dragon,
    balloon) LOOK like a dark ball by contrast — proven false (darkest top
    pixel is mid-tan sky); judge sky objects on device, not headless.
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
- **Graphics-pass conventions** (2026-06 overhaul): contact shadows share
  `blobShadowTex()`/`blobShadowMesh()`; boost flames live in `k.mesh.flames`
  (flicker uses `vrand` — cosmetic, never the seeded rng); clouds/sun/stars
  in `buildSky` (theme flags `stars`, `birds`); waterline surf is painted
  into TERRAIN vertex colors (a polar foam ribbon fails on a
  non-star-shaped island — don't retry it); corner skids are seeded decals
  over top-quartile `curvSm` runs at `raceLine` lateral; per-frame world
  animation (crowd jump, gulls, glints, lava rim, cloud drift) hangs off
  globals reset in their builders (`crowdPts`, `birds`, `foamMat`,
  `lavaGlow`, `cloudSpin`).
- **Tunnel jumbotron** (`buildTV`, tunnel tracks only): MK64-style screen on
  posts above the entrance arch. A broadcast cam mounted at the panel tracks
  the LOCAL player's kart (auto-zoom ≈16u frame) and renders the scene to a
  320×180 UnsignedByte RT every other frame in `animate()` — the screen mesh
  hides during its own pass (feedback loop otherwise). Cosmetic only, never
  touches the sim. Kart meshes are `k.mesh.group` (k.mesh is a wrapper).
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
  wind-up to top speed, MK64-style.
- **Boosts are one-shot kicks via `grantBoost(k, dur, kick, floor)`** —
  speed += kick (at least floor) once, plus a temporary cap window to
  `BOOST_CAP`. There is deliberately NO per-tick speed floor: the old
  `speed = max(speed, 120)` every tick warped every boost to 120 and made
  chained boost pads a no-op. Pads: +16/0.9s with `padCool` edge-trigger;
  single pad peaks ~124, a chained pair (gap ~118u) lands a second kick to
  the true 138 cap (verified: kicks at both pads, chain peak exactly 138).
- **Fixed-timestep render interpolation (`renderKarts`)**: meshes + camera
  render at the pose blended between the previous and current sim tick by
  `simAcc/SIM_DT`. Without it, 120Hz ProMotion frames alternate 0-and-1 sim
  steps and the kart visibly vibrates against the per-frame-lerping camera
  (ProMotion switches rates adaptively → "sometimes it vibrates"). Camera
  and kart visual lerps are dt-normalized via `frameLerp` for the same
  reason. Mesh sync lives in the render pass, NOT in updateKart.
- **Animated drivers** (`k.mesh.driver`, a seat-pivot group baked separately
  from the chassis): lean into corners (harder drifting), tuck on boost,
  glance back at a chaser within ~11u, victory bounce 3s post-finish.
  All driven render-side in `syncKartMesh` — zero sim/netcode impact. (Any
  future kart-body ink-outline must outline chassis + driver meshes
  separately now that they're split.)
- **Large-screen UI scale** (`--uiz`, set in `updateUIScale` on resize):
  every top-level UI layer `zoom`s by a viewport-derived factor — exactly
  1 at phone sizes (small screens untouched), up to 2 on desktop. The
  canvas never zooms; the steering stick converts viewport px into the
  zoomed HUD space.
- AI seek boost pads, drift deliberately into braking corners, and have a
  tight skill band (0.955–1.04) — tune pace via autopilot lap times
  (leader ~22–24s/lap; autopilot avg-skill player should finish mid-pack).

## Gameplay conventions (several are explicit user preferences)

- **No spinouts, ever.** Hits = `bonkKart` (speed cut + hop, steering kept).
  Goo slows + wobbles but never removes control.
- HUD layout (landscape, thumbs at bottom corners): big position +
  time + net indicator stacked TOP-RIGHT; lap + live standings TOP-LEFT;
  minimap true bottom-center with the drift-charge bar above it;
  DRIFT/ITEM bottom-right. The bottom-LEFT quadrant stays EMPTY — it's
  the steering thumb zone (the old big position number lived there and
  sat directly under the player's finger).
- Live standings strip (`#raceStandings`, left edge): all 8 positions at
  ~4Hz; local player gold, remote humans blue-highlighted, 🏁 when
  finished. Friend-finish toasts fire host-side (onLapCrossed) and
  client-side (snapshot finished transition). Results show +gap times.
- **Spike Shell** (`spike`, 🐚): MK blue-shell — a back-of-pack-only,
  cooldown-gated (`spikeTimer`) leader-seeker. `fireSpike` launches a
  projectile with `leaderOnly:true` that rail-follows the centerline
  (aims at `seg+12` when far, homes when within ~50u) and only detonates
  on the rank-1 kart (shrink-bonk). Falls back to a rocket if the user is
  already leading. Host-authoritative like all items; rides the proj
  snapshot (clients render it via the generic ghost-rocket mesh).
- Player starts 8th; rank-weighted items (leader pool is defense-only,
  global 30s `zapTimer` cooldown keeps ⚡ rare).
- **Item roulette is tap-to-stop** (player roll 2.2s, AI 1.0s): the first
  `ctrl.fire` while `itemRolling > 0` calls `finishRoll` (locks the item),
  the next one uses it. The item button dedupes `touchstart` + iOS's
  synthetic `click` (one tap must be exactly one fire event, else it stops
  AND instantly uses).
- AI swerve to grab an item box when empty-handed (`b.lat` per box) and
  aim for boost pads.
- **AI difficulty** (settings pane, persisted `kart3_diff`, default
  medium): `DIFFS` sets the skill band, rubber bounds, mistake rate,
  drift commitment and rocket-start rate. A/B-verified: the same mid-skill
  autopilot finishes ~2nd on easy and DEAD LAST (8th) on hard (hard was
  buffed — top skill 1.11, leaders barely sandbag). Online races use the
  HOST's setting (AI are host-simmed).
- Rubber band is bounded (per difficulty; tighter on the final lap), two 'rival' AI shadow
  the player, AI block chasers and make late-brake mistakes. AI obey the same
  physics caps as the player (`_rubber` is the only asymmetry).
- **Settings pane** (start screen ⚙): steering direction Standard/Reversed
  (flips touch AND keyboard steering) and steering sensitivity (thumb
  travel 36-110px). Persisted as kart3_steerrev / kart3_sens. **The
  DEFAULT ("Standard") is deliberately the inverted mapping**
  (`(touchSteer + keySteer) * -1`, user preference via PR #170 after a
  family playtest); "Reversed" restores the geometric mapping (thumb-right
  / right-arrow → kart screen-right, NDC-verified). Keys were originally
  hardwired geometric ("absolute"), but on a laptop that felt like being
  stuck in Reversed, so they follow the setting too (user request,
  2026-06-10). Do NOT "fix" the default back.
- **Gamepad** (`padPoll()`, polled each frame before the paused early-out):
  left stick steers, A/shoulders/triggers hold drift, B brakes, X/Y fire
  (same `pendingFire` + `net.fireCount` path as touch), Start pauses /
  confirms menus, A confirms menus outside the race. **The stick follows the
  Standard/Reversed setting exactly like touch and keys** — `padSteer` sits
  INSIDE the flip in `computeSteer()`. A geometric-always stick was tried
  first (PR #287) and the user immediately reported it as inverted
  (2026-07-11); the Standard scheme is the muscle memory on every input
  device. Do NOT move the stick outside the flip.
- Drift only engages while actually steering (|steer| > 0.28); hold DRIFT on
  GO! for a rocket start.
- **Drift model (MKDS-style, tuned after playtest)**: engaging BLENDS from
  the current steering response into the slide over ~0.3s (`lerp(steerTurn,
  driftTurn, driftRamp)`, ramp dt*3.2) — never a yank, never a dropout.
  While sliding, steer modulates the arc: full counter-steer ≈ 0.18× yaw
  (nearly straight — long drifts and snaking are controllable), full into ≈
  1.10×. Visuals: nose points INTO the slide (+driftDir yaw offset) and the
  kart leans INTO the corner (+driftDir roll) — both signs were backwards
  once; verify with behind-the-kart screenshots if touched. Mini-turbos are
  modest (kicks 8/12/16, caps 116/122/126 via grantBoost's per-boost cap) —
  measured drift-boost peak ≈ 104 vs items/pads ≈ 131. AI corner planning
  uses drift grip 1.08 (matches the model; 1.3 made them overshoot).
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
