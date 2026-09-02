# CLAUDE.md

## Domain

**The site is served at `polkiewicz.com`.** The repository is named `maattp.github.io` for GitHub Pages routing, but that hostname is **not** the live site — do not assume `maattp.github.io` is the user-facing origin. When configuring CORS, `fetch` URLs, or anything origin-sensitive, the canonical origin is `https://polkiewicz.com`.

## Site Structure

Static personal site with a collection of self-contained web utilities.

```
/index.html              - Main site (resume/portfolio)
/apps/index.html         - Launcher (iOS home screen app)
/apps/[name]/index.html  - Individual utilities
/worker/                 - Cloudflare Worker backend (see worker/CLAUDE.md)
```

Each utility is a single self-contained `index.html` file (HTML + CSS + JS inline).

All apps live under `/apps/` so iOS standalone web apps can navigate between them without showing Safari UI (iOS treats same-path navigation as staying within the app).

When adding a new utility:
1. Create `/apps/[name]/index.html`
2. Add to launcher in `/apps/index.html`

## iOS PWA Patterns

All apps are designed to run as full-screen iOS Progressive Web Apps. Use these patterns:

### Required Meta Tags

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#1a1a2e">
```

- `viewport-fit=cover` extends content behind the notch/status bar
- `apple-mobile-web-app-capable` enables full-screen standalone mode
- `black-translucent` makes the status bar overlay the content with a translucent background
- `theme-color` sets the status bar background color

### Safe Area Handling

Use CSS environment variables to handle notch and home indicator areas:

```css
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);

/* Or combine with other values */
padding-top: calc(env(safe-area-inset-top) + 20px);
```

### iOS-Specific CSS

```css
-webkit-overflow-scrolling: touch;  /* Smooth momentum scrolling */
-webkit-tap-highlight-color: transparent;  /* Remove tap highlight */
```

## Local Development

Preview the site locally:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Feed App

### Version Management

**IMPORTANT:** Increment the version number in `/apps/feed/index.html` once per PR.

The version is displayed in the Home Screen header as `v1`, `v2`, etc.

Location: `<h1>Feed <span class="version">vX</span></h1>`

## Auto App

### Version Management

**IMPORTANT:** Increment the build number in `/apps/auto/index.html` once per
change, and move `CACHE` in `/apps/auto/sw.js` to match.

The build number is displayed on the launch screen, so a player can say which
build they are running — the first thing worth knowing when a fix looks like it
didn't land, because a stale service worker is indistinguishable from one.

Location: `<div id="build">vX</div>`, paired with `const CACHE = 'auto-vX';`.
See `apps/auto/CLAUDE.md` for why these are deliberately two literals.

### Map data

The Seattle in `/apps/auto/` is imported from OpenStreetMap and USGS elevation
data by the scripts in `/tools/`, into `/apps/auto/data/`. **OSM is ODbL, so the
attribution on the launch screen and in the pause menu is a licence condition —
don't remove it.** See `apps/auto/CLAUDE.md` for how to re-run the import.

## Claw App

### Version Management

**IMPORTANT:** Increment `const VERSION` in `/apps/claw/index.html` once per PR,
and bump `CACHE` in `/apps/claw/sw.js` (`claw-vN`) when a change must reach
installed players promptly.

The version renders bottom-right. **Portrait** claw machine, Three.js + Rapier.
See `apps/claw/CLAUDE.md` — the weak grip is the design, not a bug, and the grip
constants must be re-derived with `tools/clawgrip.mjs` after any physics change.

## Zombies App

### Version Management

**IMPORTANT:** Increment `const VERSION` in `/apps/zombies/index.html` once per
PR, and bump `CACHE` in `/apps/zombies/sw.js` (`zombies-vN`) when a change must
reach installed players promptly.

The version renders bottom-right on the title screen. **Landscape-only** — see
`apps/zombies/CLAUDE.md` for the rendering, navigation and character-model laws,
each of which cost a real debugging session.

## Chat App

### Version Management

**IMPORTANT:** Increment `VERSION` in `/apps/chat/index.html` once per PR, and
bump `CACHE` in `/apps/chat/sw.js` (`chat-vN`) to match.

Three-participant chat (Matt, Tingting, Claude) backed by `/chat/*` on the
worker. Design and invariants live in `/apps/chat/PLAN.md` — the one that must
not bend: **`sender` is assigned server-side from the credential, never from
the request body.** Message bodies render as text nodes only, never innerHTML.

## Visualizer App

### Version Management

**IMPORTANT:** Increment `VERSION` in `/apps/visualizer/index.html` once per PR,
and bump `CACHE` in `/apps/visualizer/sw.js` (`visualizer-vN`) to match.

Mic-driven, early-2000s-style music visualizer (Canvas 2D; the feedback presets
draw the previous frame back through a zoom/rotate). Nine presets, tap/swipe or
arrow keys to switch. Easter egg: hold the screen (or press G) and the current
preset becomes the sky of a rail shooter that spawns enemies on the beat.
Verify headlessly with `node tools/visverify.mjs` (fake mic, screenshots every
preset on desktop and phone viewports plus the game).

## Photos App

### Known Limitations

**Memory usage on large libraries:** The photo grid accumulates blob URLs and DOM nodes as you scroll (infinite scroll, no virtualization). Fine for hundreds of photos; may need virtualized scrolling if the library grows to thousands.
