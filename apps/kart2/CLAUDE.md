# Kart 2 — CLAUDE.md

Project-specific notes for the **Kart 2** app. Read this before changing
`apps/kart2/index.html`. The repo-root `CLAUDE.md` covers site-wide rules
(iOS PWA meta tags, `/apps/` structure, canonical origin `polkiewicz.com`).

---

## ⚠️ #1 LESSON: don't guess at 3D/visual bugs — RENDER IT

This app is a WebGL game. For three rounds I tried to fix a "weird finish
line / random walls" bug by **reading code and guessing**, and shipped three
wrong/incomplete fixes. The bug was only found in ~20 minutes once I actually
**rendered the scene headless and looked at it**, then **probed the geometry
numerically**.

**If a visual/3D bug is reported, set up the headless render harness FIRST.**
It is fast, and there is no substitute for seeing the pixels + measuring the data.

### Headless render harness (this works in this environment)

```bash
cd /tmp && mkdir kartshot && cd kartshot && npm init -y
npm i puppeteer
npx puppeteer browsers install chrome          # downloads Chromium
npm i three@0.128.0 && cp node_modules/three/build/three.min.js .   # vendor three (CDN may be blocked in headless)
```

Make a debug copy of the page that (a) loads three from the local file and
(b) exposes the internals from inside the IIFE:

```js
// prep.js
let html = fs.readFileSync('.../apps/kart2/index.html','utf8');
html = html.replace('https://cdnjs.cloudflare.com/.../three.min.js', './three.min.js');
html = html.replace('animate();',
  'window.__dbg={THREE,scene,camera,renderer,centerline,normals,tangents,setState:(s)=>{state=s;}}; animate();');
fs.writeFileSync('/tmp/kartshot/kart.html', html);
```

Launch Chromium with **software WebGL** (no GPU in CI):

```js
puppeteer.launch({ headless:'new', args:[
  '--no-sandbox','--enable-unsafe-swiftshader',
  '--use-gl=angle','--use-angle=swiftshader' ]});
await page.setCacheEnabled(false);                      // important
await page.goto('file:///tmp/kartshot/kart.html?cb='+Date.now()); // cache-bust
await page.waitForFunction('window.__dbg && window.__dbg.centerline.length>0');
```

Then to inspect:
- **Free camera:** `window.__dbg.setState('paused')` freezes the render loop's
  camera control; hide overlays with `document.querySelectorAll('.screen').forEach(s=>s.style.display='none')`;
  set `camera.position/lookAt`, call `renderer.render(scene,camera)`, screenshot.
  Useful angles: top-down on the start line, low "driver" angle, whole-track perspective.
- **Read screenshots** with the image-reading tool.
- **Probe geometry numerically** via `page.evaluate`: raycast (`THREE.Raycaster`)
  through suspect pixels to ID the mesh; dump `geometry.attributes.position` /
  `normal` / `index`; compare each vertex to where it *should* be; check for
  tangent/normal flips (`dot(n[i], n[i+1]) < 0.5`), long edges, degenerate tris.
- **Run the real game loop:** `page.click('#startBtn')`, wait through the
  countdown, and capture `pageerror`/`console` — catches runtime exceptions in
  the whole pipeline (audio, items, drift) with zero false confidence.

### swiftshader caveat (don't get fooled like I did)
swiftshader (software GL) has **its own shader bugs that are NOT on real
hardware**. Notably its `MeshLambertMaterial` produced a fake "bowtie/fan"
artifact on perfectly-good geometry. To check whether something is a real
geometry bug vs a swiftshader artifact, **force materials to
`MeshBasicMaterial`** (simple shader, renders geometry faithfully) and
re-render. If it's clean under MeshBasic, the geometry is fine and the
artifact won't appear on the iPhone.

---

## What this is

A single, self-contained `index.html` (HTML + CSS + inline JS) — a 3D kart
racer for **iPhone in portrait**, three.js **r128** from cdnjs. Tilt to steer,
hold to drift for a boost, items, 3 laps. Everything (geometry, audio, UI) is
generated at runtime; there are no external assets.

## Architecture (all inside one IIFE)

- **`worldGroup`** holds all rebuildable world geometry (sky, lights, road,
  curbs, guardrails, start line, scenery, boost pads, item boxes). `loadTrack(idx)`
  removes + `disposeObject()`s the old `worldGroup` and rebuilds it. **Karts,
  particles, projectiles and hazards live directly in `scene`** so a track
  reload doesn't dispose them.
- **Track geometry** comes from `centerline[]`, `tangents[]`, `normals[]`
  (length `N_SAMPLES = 900`), sampled from a **closed `CatmullRomCurve3`**.
- **State machine:** `state ∈ menu | countdown | racing | finished | paused`
  drives `animate()`.
- **Karts:** `karts[]`, `player = karts[0]`; each has pos (XZ), `theta`, `speed`,
  `groundY`, progress/lap tracking, drift/boost/item/bonk/shield timers, and
  per-character stat multipliers.
- **Sections in order:** helpers → DOM refs → config/data (CHARS, TRACKS,
  ITEM_DEF) → storage → three init → world/track build → particles → karts →
  progress/physics → items → camera → rankings/HUD/minimap → audio → input →
  menu UI → flow (start/countdown/pause/finish) → main loop → boot.

## Key features
Tilt + touch-drag + keyboard steering; hold-to-drift with charged mini-turbo;
boost pads; **items** (boost / homing rocket / banana / shield / lightning bolt)
with item boxes, a roulette, an on-screen button, and AI usage (rank-weighted
so trailing racers get stronger items); **3 themed tracks** (Sunshine Bay day /
Neon Circuit night / Sunset Canyon) with a track-select; **character select**
(speed/accel/handling trade-offs); minimap; position toasts; start light-tree;
confetti finish; **per-track best lap/time in localStorage**; tilt-sensitivity
slider + recenter; haptics; pause/resume (+ auto-pause on `visibilitychange`);
WebAudio engine + chiptune music + SFX (all mutable); adaptive pixel-ratio.

## Gotchas & conventions (learned the hard way)

- **Track tangents/normals:** compute them from **finite differences of the
  sampled centerline positions**, NOT from `curve.getTangentAt()`.
  `getTangentAt()` on a *closed* Catmull-Rom returns a bad tangent near the seam
  (a ~73° flip around sample ~889 here). A flipped normal swaps the road ribbon's
  left/right edges and twists the road + guardrails into a crossing "wall" mess
  at the finish line. (This was the real "random walls" bug.)
- **Custom ribbon winding faces down.** The road `BufferGeometry`'s triangle
  winding produces downward normals, so with default back-face culling the
  road's *top* is culled and you **see through it to the ground**. The road
  material is `side: THREE.DoubleSide` to fix this. If you build new ribbon
  geometry, either fix the winding or use DoubleSide. (This — not "elevation" —
  was the real "see through the ground" bug; flattening the tracks did not fix it.)
- **Tracks are flat (`y = 0`).** Elevation was removed because a raised road
  over a single flat ground plane shows void/gaps beside it. If you re-add
  elevation you MUST also build a connected terrain skirt under/around the road,
  and thread `centerline[i].y` through every piece of geometry + `kart.groundY`
  + the camera.
- **Ground-level decals** (start/finish line, boost pads): use `polygonOffset`
  + a small Y lift (~0.1) and `renderOrder`. Do **not** use `depthWrite:false`
  on opaque decals — it causes z-ordering artifacts.
- **Start banner** must be offset to sit *in front of* the banner bar box, not
  at its center (otherwise it z-fights / hides inside the bar).
- **Lap logic:** karts start on a grid just *past* the start line; a lap counts
  on a forward seam crossing (prev seg > 0.7·N, new seg < 0.25·N); finishing =
  `TOTAL_LAPS` crossings.
- **Tilt:** `gamma` is negated (tilt left → steer left) and recalibrated at "GO".
  The sensitivity slider is **inverted** so dragging right = more sensitive:
  the internal divisor `sensitivity = 58 - sliderValue` (smaller divisor = more
  sensitive). Lower divisor = twitchier.
- **Getting hit = a brief "bonk"** (speed cut + bounce + sparks) with **full
  steering retained** — NOT a loss-of-control spinout. The user explicitly
  dislikes spinouts; do not reintroduce uncontrollable spins.
- **Drift** only engages when actually steering (`|steer| > 0.28`) so a hold
  while pointing straight doesn't cause a random veer; direction is taken from
  steering (never random), eases in via `driftRamp`, and tightness is modulated
  by steering into/out of the committed direction.
- **Audio** can't be heard in CI — code-review it; the engine is stacked
  detuned saws + sub through a speed-driven lowpass; music is a square-lead +
  triangle-bass + noise-drum chiptune loop over I-V-vi-IV.

## Verification checklist before shipping a change here
1. JS syntax: `node -e "new Function(<inline script body>)"`.
2. Scan for stray non-ASCII (emoji/`—`/`…`/`·` are intentional).
3. `python3 -m http.server` and confirm the page returns HTTP 200.
4. **For anything visual or physics-related: render it headless** (see top),
   from the relevant cameras, and run a full START→race session capturing
   `pageerror`. Force `MeshBasicMaterial` to distinguish geometry bugs from
   swiftshader shader artifacts.
5. Be honest in the PR about what was and wasn't verified (no GPU, no audio in CI).
