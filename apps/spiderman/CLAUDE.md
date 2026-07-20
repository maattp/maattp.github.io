# Spider-Man

One-thumb, 2D, retro side-scrolling web-swinger. Same idioms as pixelrun:
one self-contained `index.html`, canvas 2D pixel art, fixed 60 Hz sim,
3×5 bitmap font, shell-only stale-while-revalidate service worker.

## Version Management

**IMPORTANT: bump `const VERSION` in `index.html` once per PR.** It renders as
`V1` on the title screen. When bumping, ASSERT the old value is present (check
open PRs for the true latest before bumping). When a PR should reach installed
players promptly, also bump `CACHE` (`spiderman-vN`) in `sw.js`.

## Control model (the design contract — V2)

**Pure momentum. The player NEVER stops and NEVER moves backward.** The V1
survey specified drag-to-move free roaming; the user playtested it and it
killed the swing fantasy ("having to drag around is really awkward"). V2
replaced it after an explicit re-decision. Do NOT reintroduce drag input.

- **Auto-run**: always moving forward on roofs; swing-landing momentum decays
  into run speed rather than snapping.
- **Airborne + hold** = shoot a web at the best auto-picked anchor and swing;
  release = let go. While held with no rope, the attach retries every 4 frames
  so swings chain as soon as an anchor appears. Anchors behind are heavily
  penalized (forward-only game).
- **Tap** (<230 ms, <12 px) = jump (ground or coyote frames). That's the only
  other verb.
- **Walls auto-climb**: any airborne horizontal collision starts an automatic
  scurry up the wall, mantling onto the roof and resuming the run. Verticality
  is flow, not chores.

## Art (V2)

Spidey is a pre-rendered chibi sprite sheet: pixel-string frames in `SPR_SRC`
(palette `SPAL`), baked to canvases (+ flipped variants) at boot. The swing
pose is rotated along the rope angle at draw time. Buildings get per-id decor
via `bStyle()`: window styles, fire escapes, billboards, cornices, water
towers, AC units. Keep new art in this system — no raw fillRect character
drawing (that's what made V1 read as primitive).

## Level design law

Levels are handcrafted city topology built by `buildLevel()`: `b(x,w,h)`
raises a building from the street (SR=57), returning its roof row. Web anchors
are **derived** — every exposed roof corner is one — plus explicit `hook()`s.
Reachability (V2 is FORWARD-ONLY — no backward movement exists): every crossing
is entered from its left edge; gaps > 5 tiles (plain-jump limit at JUMP_V/GRAV/
RUN) MUST have an anchor ahead: a taller building's corner or a hook. The
street (row ≥ SR) is instant death; nothing may require touching it. Never
place spikes at the landing edge after a gap.

Physics constants are coupled: `JUMP_V`/`GRAV`/`RUN` set the 5-tile jump law
above, and `ANCHOR_FAR`/`ROPE_MAX` bound how wide a hook gap can be. Retune one,
re-walk the levels (bot run below).

## Testing

Debug harness on `window.__dbg`: `startLevel(n)`, `stepN(n)`, `snapshot()`,
`hold(dx,dy)` / `drag(dx,dy)` / `release()` / `tap()` (drive the real input
path), `bot` (autopilot: runs right, webs when falling, climbs walls, releases
on the forward upswing), `errors`, `anchors()`, `ents()`. `?bot=1` starts
attract mode. Drive headless via Chrome CDP (see repo memory recipe) and ALWAYS
also screenshot with `Emulation.setDeviceMetricsOverride` at deviceScaleFactor 3
— DPR 1 masks canvas-sizing bugs.

The service worker serves stale builds to localhost tests — clear caches +
unregister the SW and reload once before evaluating a fresh edit.

## Not yet built (deliberate v1 cuts)

Music (SFX only), gamepad support, more levels, ceiling crawl, objectives
(rescues), landscape-specific menu layouts beyond the simple branches.
