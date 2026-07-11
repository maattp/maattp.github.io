# Pixel Run

## Version Management

**IMPORTANT: bump `const VERSION` in `index.html` once per PR.** It renders as
`V12` in the bottom-right corner of the title screen and exists so a phone's
running build can be identified at a glance (the service worker makes staleness
otherwise invisible). Started at 12 = the 12th Pixel Run PR (#238–#249).

When bumping, ASSERT the old value is present (a search-and-replace bump
against a stale base has silently no-opped twice — check open PRs for the
true latest version before bumping).

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

## Landscape & gamepad

The game plays in both orientations. Portrait sizing targets W≈250, landscape
targets H≈240 (same sprite scale on a given phone). Screens with portrait
vertical stacks have explicit `W > H` layout branches: title (compact centred
menu column, hero+pet stage-right, stats card top-left), game-over (buttons
side by side), level select and trophies (two columns). When adding UI, check
it against a ~420×195 canvas, not just portrait.

Gamepad (`padPoll()`, standard mapping, polled per rAF): A jump, B/X/dpad-down
slam, Start pause; menus A confirm / B back / X daily / Y pet cycle; dpad
feeds the Konami code; level select has a pad cursor (`ui.padSel`). All pad
input drives the same primitives as touch (pressJump/releaseJump,
input.slamReq, startRun…), never a parallel path.

## Tuning contracts

Physics and generator constants are coupled — the derivation comments at the
constants block (`JUMP_V`/`GRAV`) list which pattern heights, gap widths, and
enemy-train spacings must move together. Song data is arrays of 16-step bars
validated at boot; keep new bars exactly 16 steps. Theme indices are load-bearing across parallax, songs, and palettes:
water=3, sky=4, frost=5, haunt=6, castle=7 (8 worlds total, magma final).
