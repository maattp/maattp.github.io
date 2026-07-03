# Pixel Run

## Version Management

**IMPORTANT: bump `const VERSION` in `index.html` once per PR.** It renders as
`V12` in the bottom-right corner of the title screen and exists so a phone's
running build can be identified at a glance (the service worker makes staleness
otherwise invisible). Started at 12 = the 12th Pixel Run PR (#238–#249).

When a PR should reach installed players promptly, also bump `CACHE`
(`pixelrun-vN`) in `sw.js` — the service worker serves stale-while-revalidate,
so without a cache bump users get the previous build for one extra launch.

## Testing

The game ships a debug harness on `window.__dbg`: `startRun()`, `stepN(n)`
(synchronous fast-forward), `bot` (autopilot), `snapshot()`, `stats`, `errors`,
live access to the `ground`/`tiles`/`water` maps, and `musicErrors`. Drive it
headless with Chrome CDP (see the repo memory / scratchpad `drive.mjs` recipe).
`?bot=1&seed=N` gives a reproducible attract mode.

**The service worker serves stale builds to localhost tests** — always clear
caches + unregister the SW and reload once before evaluating a fresh edit.

## Tuning contracts

Physics and generator constants are coupled — the derivation comments at the
constants block (`JUMP_V`/`GRAV`) list which pattern heights, gap widths, and
enemy-train spacings must move together. Song data is arrays of 16-step bars
validated at boot; keep new bars exactly 16 steps. Theme indices are
load-bearing (water=3, sky=4, castle=5) across parallax, songs, and palettes.
