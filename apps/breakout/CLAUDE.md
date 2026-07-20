# Breakout

Classic one-thumb brick breaker, requested via the feedback app (2026-07-15
KV entry: "I need a breakout app NOW"). Same idioms as pixelrun/spiderman:
one self-contained `index.html`, canvas 2D, fixed 60 Hz sim, 3×5 bitmap font,
shell-only stale-while-revalidate service worker.

## Version Management

**IMPORTANT: bump `const VERSION` in `index.html` once per PR** (shown as `V1`
on the title screen; assert the old value is present when bumping). When a PR
should reach installed players promptly, also bump `CACHE` (`breakout-vN`)
in `sw.js`.

## Controls / design

- Drag anywhere = paddle moves by relative delta (`DRAG_GAIN`) so the thumb
  never covers the ball. Tap = launch stuck ball(s).
- Playfield is a fixed 250px logical width (`PF`) centered in the canvas —
  brick geometry never depends on device width.
- Levels are `PATTERNS` (rows of `COLS` chars, '1'-'4' = brick point/color
  tier, '.' = empty). **Every brick breaks in ONE hit** — color means points
  (tier×10), never durability. Multi-hit bricks were shipped in V1 and read
  as "bricks recolor instead of breaking" (user report); don't reintroduce
  them without a visually distinct armored-brick treatment. All patterns loop
  forever with `game.loop` speeding balls up.
- Power-ups drop from destroyed bricks (12%): W = wide paddle 12s, M = +2 balls.
  Life is lost only when the LAST ball falls.
- Ball sim runs 2 substeps/frame and clamps `|vy|` ≥ 0.22·speed so the ball can
  never go flat-horizontal forever.

## Testing

`window.__dbg`: `startGame()`, `stepN(n)`, `snapshot()`, `launch()`, `bot`
(perfect paddle tracking — will clear levels indefinitely), `errors`,
`balls()`/`grid()`/`drops()`. `?bot=1` = attract mode. Drive headless via
Chrome CDP with `Network.setBypassServiceWorker` + DPR-3 metrics (see repo
memory; the SW WILL serve you a stale build on localhost otherwise).
