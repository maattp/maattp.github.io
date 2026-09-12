# Space Flight — CLAUDE.md

F-Zero-style anti-grav racer. One self-contained `index.html`, Three.js **r128**
from cdnjs, landscape iPhone/Android PWA. Prototype scope (v1): one track
("Mute Orbit"), the player plus seven CPUs. Online (8 players, `worker/`) comes
after the playtest — keep the sim deterministic and stepped (`simTick(1/60)`).

## ⚠ Version bump — EVERY PR

Increment `SF_VER` in `index.html` (bottom-right of the menu) and `CACHE` in
`sw.js` (`spaceflight-vN`). The service worker is the Wreck & Ruin shell-only
pattern (fast install, stale-while-revalidate by URL).

## ⚠ Verify by rendering

```
python3 -m http.server 8000 &
node tools/sfverify.mjs            # autopilot race (all 8 must finish), lap-time / wall / energy stats, shots in tools/data/sfshots/
node tools/sfrepl.mjs "expr" "shot:path.png"   # ad-hoc CDP driver; ?dbg=1 exposes window.__sf
node tools/sficon.mjs              # regenerate the Home Screen icons from gen-icon.html
```

`__sf` exposes `machines / player / state / TRACK / frameAt / sampleAtS /
simTick / startGame / updateCamera / camera`, `freeBoost` (setter) lifts the
lap-1 boost lock. `window.__hold = true` freezes the real-time sim so a race can
be stepped; `window.__freeCam = {x,y,z,tx,ty,tz,fov}` overrides the camera. To
autopilot the player give it an `ai` object and flip `isPlayer` off while
stepping (see the verify tool). SwiftShader renders everything brighter than a
phone: judge colour on a device, judge geometry in the shots.

## Engine

- **Ribbon coordinates.** A machine is `(s, lat, yaw, speed, slide, air)`:
  distance along the closed spline, lateral offset, heading relative to the
  track tangent, speed, centrifugal slide velocity, jump height. World position
  comes from `frameAt(s)` (position, tangent, banked side/up vectors). Machines
  therefore can never fall off; the walls are hard clamps at `w − 2.4`.
- **Track** = `TRACK_DEF.pts` `[x, y, z, halfWidth]` control points, closed
  centripetal Catmull-Rom, **resampled to exact 4u arc-length** so
  `sample i` sits at `s = i·TRACK.step` (the raw spline samples are not uniform;
  indexing them by `s/4` drifted the camera 40u). Bank comes from smoothed
  curvature (`curv·34`, clamped ±0.55 rad). The up-vector is `tangent × side`
  — with the cross product the other way round every machine and rail was
  built *under* the road.
- `frameAt(s, out)` fills a scratch object: anything holding two frames at once
  passes its own (`_frA`, `_frB`) — the camera and the AI both once compared a
  frame with itself.
- **Handling.** Steer eases `yaw` toward `steer·MAX_YAW`; lateral velocity is
  `speed·sin(yaw) + slide`, where `slide` integrates `curv·v²·SLIDE_K` minus
  damping (braking multiplies grip). That centrifugal push is the whole
  challenge: at speed you must steer into a bend or you drift into the outer
  wall. Banking cancels part of it.
- **Energy** (0–100) is health *and* fuel: boost costs `BOOST_COST` and is
  locked until lap 1 is done (F-Zero X rule; `__sf.freeBoost = true` to test),
  wall scrapes cost `into·0.12 + 1.5` with a 0.18 s cooldown, machine contact
  costs both parties (a boosting rammer deals ×1.8 and takes ×0.5), the pink
  strip on the return straight gives `RECHARGE_RATE`/s. Zero energy = explode,
  respawn 2.6 s later with 55.
- **Features**: dash plates (yellow chevrons, free 1.4 s dash), the crest jump
  (`jump` fraction range lifts you ballistically), recharge strip.
- **AI**: aims at the inside of the upcoming bend plus a personal lane, seeks
  dash plates and (when energy < 45) the recharge strip, cancels slide with a
  predictive lateral controller, brakes only when the slide would reach the
  wall, boosts on straights with an energy reserve, mild rubber band on `top`.
- **Camera**: chase, 18u back, riding the track's up-vector (banks tilt the
  view), FOV grows with speed and boost. Rival engine sprites hide within 10u
  of the camera (a machine passing through the camera filled the screen).

## Tracks and themes

`TRACKS[i]` = `{ name, theme, w, pts, dash, recharge, lineF }`; `loadTrack(i)`
rebuilds the ribbon and the world and re-applies the theme (`applyTheme`:
background, fog, lights). A theme names every colour the world builder uses
(road, rails, walls, skirt, pylons, lane lines), `groundY`, and `scenery`
(`'city'` → towers + planet sky, `'canyon'` → banded mesas + sunset dome).
Red Canyon's points are generated: a lemniscate figure-8 whose two crossings
sit 40u apart in height, so the halves cross on a flyover. Glacier Loop is
hand-drawn (ice kit: crystals, ridges, moon, aurora ribbon). Nova Spire is
hand-drawn and upright: a banked climbing sweep onto a flyover across the
middle, a descending western bowl, a run along the north, then a hook that
dives under the flyover and swings home (the loop + barrel-roll version was
playtested and rejected as glitchy). The engine still supports `rmf: true`
(unused today): track frames become rotation-minimising (parallel transport of the side vector, closure twist
spread along the lap) instead of horizontal, so the road may go vertical
and upside down; a 5th control-point value is a designed roll (radians)
added on top of the curvature bank — the barrel roll is 0 → 2π along a
straight, and every later point stays at 2π. Curvature is measured about
each frame's own up. On rmf tracks the chase camera does not blend toward
world up. Recharge overlays are built one strip per contiguous run — a single
strip across separate pits stitched floating slabs between them. `gates` (lap fractions) place lit half-torus arches; the space kit
has no ground, so pylons are skipped when taller than 600u. The verify tool
races and screenshots every track (`t<i>-race*.png`, `t<i>-overview.png`).

## Online (8 pilots)

`SpaceRoom` DO on `/sf/rooms` (worker), an 8-seat copy of the Fable Kart relay;
`/sf/turn` hands out ICE servers (Cloudflare TURN when the worker has the
`CF_TURN_KEY_ID`/`CF_TURN_API_TOKEN` secrets, STUN otherwise). Star topology:
the host runs the full sim — its own machine, CPUs for every empty seat, and
each remote pilot's machine on the pose that pilot reports (`input.p` =
s, lat, yaw, speed, boostT at 30 Hz over the WebRTC channel, WebSocket
fallback). The host owns energy, collisions, laps, ranks and the finish; it
grants boosts a client asks for (`input.b` counter) and applies wall damage a
client reports (`input.w` cumulative, capped per report). Clients run their
own machine's real sim locally (prediction), interpolate everyone else from
20 Hz snapshots with a 100 ms buffer, and adopt host-owned state from the
snapshot (energy, laps, rank, finish, destruction, boosts on a rising edge).
`NET_VER` folds `SF_VER` and a hash of the physics constants and track
points, so mismatched builds cannot share a room. No host migration: when the
host leaves the room ends. Verify with `node tools/sfonline.mjs` (needs
`(cd worker && npx wrangler dev --port 8787)` and the http server).

## Controls

Left half: slide to steer (relative to the touch start). Right side: BOOST
button (or any right-half tap), BRAKE button. Keyboard: arrows/WASD, Space/Shift
boost, Down/S brake, P pause.

## Backlog (user-requested, not started)

- **TURN key (user will do it at home).** Cloudflare dashboard → Calls →
  create a TURN key, then in `worker/`: `npx wrangler secret put
  CF_TURN_KEY_ID` and `npx wrangler secret put CF_TURN_API_TOKEN`. Until
  then `/sf/turn` returns STUN only and NAT-blocked phones use the relay.
  Cost model: Cloudflare TURN bills per GB relayed (only traffic that could
  not go direct); the input/snapshot stream is ~2 KB/s per client, so a
  full 8-pilot race relayed end to end is a few MB. The worker endpoint is
  origin-gated and mints 4-hour credentials only; nothing is exposed that
  lets outsiders relay arbitrary traffic on the account beyond those
  short-lived credentials.
- **Audio pass.** The current WebAudio sound effects read as whiny and
  annoying; replace them with punchier, lower-pitched effects. Write an epic
  chiptune per map (Mute Orbit, Red Canyon, Glacier Loop, Nova Spire) — a
  real composed track each, not the shared 4-chord loop — in the style of
  Fable51 Kart's `composeSong` per-map songs.

## Next (after the playtest)

Online (Fable Kart netcode port, 8 seats), more tracks (loops need parallel-
transport frames; the current side vector is horizontal), side attack /
spin attack, machine select with stats, pit-strip visual, music pass.
