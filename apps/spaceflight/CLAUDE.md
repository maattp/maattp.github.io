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

## Controls

Left half: slide to steer (relative to the touch start). Right side: BOOST
button (or any right-half tap), BRAKE button. Keyboard: arrows/WASD, Space/Shift
boost, Down/S brake, P pause.

## Next (after the playtest)

Online (Fable Kart netcode port, 8 seats), more tracks (loops need parallel-
transport frames; the current side vector is horizontal), side attack /
spin attack, machine select with stats, pit-strip visual, music pass.
