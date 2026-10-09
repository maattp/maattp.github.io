# Auto

An open-world driving/on-foot game set in a 31.2 km x 31.2 km Seattle (`MAP_HALF` 15600), built from
real map data. Landscape iPhone PWA: left thumb stick, right-side buttons, drag
the right half to look.

## The guide: where everything else lives

This file used to hold every section below, and at ~530 KB it was loaded whole
into any session that touched `apps/auto/`. It now keeps only what every change
needs; the rest moved **verbatim** into topic files in `apps/auto/guide/`.
**Before changing a system, read its guide file** -- the laws in them each cost
a real debugging session, and they are not repeated here.

When code or an old note cites `CLAUDE.md "Some Heading"`, find it with
`grep -n "Some Heading" apps/auto/guide/*.md apps/auto/CLAUDE.md`.

- **`guide/map-import.md`** (35 KB) -- how OSM/USGS become data/, re-running tools/, the map's extent and growth, the islands.
  Sections: "Where the map comes from"; "Keeping the roads clear"; "What the map looks like from above"; "The map grew to 27.6 km (v163)"; "The map grew to 31.2 km (v167)"; "The islands across the Sound (v151)"; "The minimap at the map's edge (v166)".
- **`guide/roads.md`** (86 KB) -- junctions, bridges, street and freeway grading, SR-99, one-way traffic, shimmer and jolt.
  Sections: "One-way traffic"; "Shimmer and jolt: two things that read as "janky""; "Junctions, dead ends, bridges"; "Street grading: the ground fitted to the streets"; "Parked cars sit on the slope"; "Freeway grading: decks and freeway chains are one profile"; "SR-99: ride it the way a player does".
- **`guide/rendering.md`** (52 KB) -- pipeline, shadows, surfaces, judging screenshots, draw-call budget, the gfx169 pass, the trees.
  Sections: "Rendering pipeline"; "Shadows: snap the box, fade its edge"; "Surfaces: glass, windows, roofs, trees, ground"; "Judging how it looks"; "Draw-call budget"; "Mountains on the horizon"; "Far buildings take their real colour (v166)"; "A phone-neutral graphics pass (docs/gfx169)"; "A green Seattle: trees as records, three levels of detail".
- **`guide/city.md`** (23 KB) -- building variety and outliers, street objects, landmarks, parks, lots/plazas/yards.
  Sections: "Buildings: variety"; "Houses: dormers, garages, and modern townhomes (v156)"; "Buildings: the outlier scan"; "Solid street objects"; "Landmarks"; "Parks"; "Lots, plazas and yards".
- **`guide/models.md`** (45 KB) -- vehicle, character and prop models: how they are built and judged.
  Sections: "Models".
- **`guide/vehicles.md`** (54 KB) -- driving model, aircraft and flight, boats, the seaplane dock, bikes, jet skis, the balloon.
  Sections: "Vehicles"; "Flying"; "The seaplane dock, the boat and the quad"; "Bicycles and the bike paths (v147)"; "The jet ski and the runabout, rebuilt (v147)"; "The hot air balloon".
- **`guide/performance.md`** (36 KB) -- the 8x Mac stand-in, memory, hitches, flight recorder, boot cache.
  Sections: "Phone performance: the Mac stand-in"; "The flight recorder (v168)"; "Boot time and the boot cache".
- **`guide/sound.md`** (18 KB) -- the synthesised audio: engines, one-shots, ambience, radio.
  Sections: "Sound".
- **`guide/on-foot.md`** (29 KB) -- swimming, fighting, WASTED/siren/guns, stunt jumps, the crowd (living streets).
  Sections: "Swimming (v154)"; "Fighting on foot"; "Stunt jumps"; "WASTED, the siren, and finding a gun"; "The crowd: living streets".
- **`guide/transit.md`** (31 KB) -- Monorail, Link light rail, BNSF freight, the Bainbridge ferry.
  Sections: "The Monorail"; "Freight: BNSF's main line (v160)"; "The Seattle-Bainbridge ferry (v164)"; "Link light rail (v146)".
- **`guide/activities.md`** (36 KB) -- fishing, fish toss, Great Wheel, golf, arcade, pinball, hockey, ATC, Duck Tour, coffee, Seafair, hoops, Needle, Tech Tour, taxi fares.
  Sections: "The wallet and the Seattle Passport (v194)"; "Fishing off the piers (an Easter egg)"; "The flying fish at Pike Place (v129)"; "The Great Wheel turns, and you can ride it (v131)"; "Golf at Interbay (v132)"; "The Belltown arcade (v133)"; "The pinball museum (v136)"; "Hockey night at Climate Pledge Arena (v137)"; "Boeing Field's control tower and FINAL APPROACH (v138)"; "The Duck Tour (v139)"; "First Cup Coffee at Pike Place (v140)"; "Seafair: unlimited hydroplanes on Lake Washington (v141)"; "Basketball in the parks"; "Up the Space Needle"; "The Tech Tour"; "Taxi fares".
- **`guide/police-fire.md`** (38 KB) -- wanted levels, police missions, the tank, fire apparatus and calls.
  Sections: "Wanted levels (police.js)"; "Police missions (policemissions.js)"; "The tank"; "Fire apparatus and fire calls".
- **`guide/known-gaps.md`** (7 KB) -- what is knowingly unfinished or wrong, with the reasons.
  Sections: "Known gaps".

## Layout

```
index.html                  shell: meta, CSS, HUD DOM, control zones
sw.js                       offline cache (see "Offline" below)
vendor/three-0.160.0.module.js   vendored Three.js (NOT a CDN import)
data/                       the imported city -- see "Where the map comes from"
src/three.js                re-export shim; every module imports THREE from here
src/util.js                 math, seeded RNG, 2D geometry helpers
src/mapdata.js              fetches and decodes data/; the other half of the
                            binary formats that tools/ writes
src/geo.js                  coordinate frame + the lookups over the rasters
src/citygen.js              decodes the road graph and footprints, indexes them,
                            and owns the paved-surface queries
src/build.js                Builder (merged geometry) + mergeByMaterial
src/textures.js             every texture, drawn into canvases at boot
src/world.js                terrain, water, sky, streamed chunks, far skyline
src/mountains.js            the Olympics, Rainier and the Cascades: one sky-layer draw (see "Mountains on the horizon")
src/trees.js                every tree: planted per chunk as records, drawn far (merged),
                            mid and near (instanced); see "A green Seattle"
src/landmarks.js            landmarks to published dimensions, + their solids
src/lmdowntown.js           the Arch, Central Library, Aquarium, Colman Dock terminal, Kerry Park and the Locks, from their OSM plans
src/vehicles.js             vehicle models + the arcade driving model
src/traffic.js              traffic AI, parked cars, police units' driving, A*
src/police.js               the wanted levels: what each sends, guns, the helicopters, search, busted
src/policemissions.js       police missions (MISSION in a police vehicle): the suspects and their getaway
src/taxi.js                 taxi fares (FARE in a taxi): the hail, the ride, the meter and tip, the drop-off
src/peds.js                 humanoid builder + pedestrian/cop/SWAT crowd
src/player.js               on-foot/driving state machine + chase camera
src/controls.js             touch stick/buttons + keyboard fallback
src/hud.js                  minimap, full map, readouts
src/needletop.js            the Space Needle's elevator, deck and viewers
src/arcade.js               the Belltown arcade: storefront, room, cabinet
src/arcadegames.js          its six games
src/pinball.js              the pinball museum: storefront, the machine's screen, its sounds
src/pinballtable.js         EMERALD CITY: the table's geometry, physics and rules (no DOM)
src/hockey.js               hockey night at Climate Pledge Arena: marquee, 16-bit screen, pad, sound
src/hockeygame.js           the hockey game itself: skating, puck, goalies, team AI (no DOM)
src/atc.js                  Boeing Field's control tower: FINAL APPROACH's screen, finger and sound
src/atcgame.js              FINAL APPROACH itself: arrivals, paths, landing zones, separation (no DOM)
src/ducktour.js             the Duck Tour: kiosk at Seattle Center, the Lake Union ramp, the tour and its quackers
src/barista.js              First Cup Coffee at 1912 Pike Place: storefront, the counter, the stations, sound
src/baristagame.js          MORNING RUSH itself: orders, recipes, the machine's timing, customers (no DOM)
src/parachute.js            bailing out of an aircraft in the air: free fall, the canopy, landing
src/hydrorace.js            Seafair: the Lake Washington course, pits, log boom, rooster tails, race rules, AI, the jets
src/golf.js                 three par-3s at Interbay
src/wheelride.js            the Great Wheel's turning half and the ride on it
src/fishtoss.js             the fish stall at Pike Place Market + the catching game
src/hoops.js                basketball courts in the parks + the free-throw game
src/stunts.js               stunt-jump ramps (geometry + height query) and their scoring
src/monorail.js             the Seattle Center Monorail: beams, stations, both trains
src/link.js                 Link light rail's 1 Line: tracks, guideway, bores, stations, the trains
src/freight.js              BNSF's main line: the bed and its carve, crossings and gates, the freights, driving
src/railcars.js             freight rolling stock: BNSF / CN locomotives, hoppers, coal, tank cars, boxcars, lettering
src/ferry.js                WSF's Seattle-Bainbridge ferries: the boats, their decks as a moving surface, the terminals' roads
src/bikes.js                bike paths drawn and ridden, AI cyclists, bike-share docks
src/piers.js                every other pier OSM maps, as a deck on piles; decks under sheds in the sea
src/islands.js              the islands across the Sound: Easter eggs, the Sasquatch, Blake's deer
src/pickleball.js           the pickleball court on Bainbridge and its screen
src/pickleballgame.js       PICKLEBALL itself: singles, the two-bounce rule, the kitchen (no DOM)
src/shadowcache.js          phones: the city's shadows drawn once, only movers per frame
src/chunkcull.js            the city's chunk groups frustum-culled whole before the scene pass
src/nearshadow.js           the player's own shadow map, folded into the sun's in every lit material
src/career.js               the saved wallet (auto-career) and the Seattle Passport: rank + completion counts
src/effects.js              particles + tracers
src/audio.js                all sound, synthesised: engine models, one-shot bank,
                            positional traffic/sirens, radio (see "Sound")
src/main.js                 boot sequence, game rules, frame loop

tools/proj.py               THE projection. Mirrored by geo.js -- change both.
tools/osm_extract.py        .osm.pbf -> projected raw_*.json  (slow, rare)
tools/build_raster.py       DEM tiles + water polygons -> height/surface/water
tools/build_roads.py        OSM ways -> roads.bin, and the graph assertions
tools/build_buildings.py    OSM footprints -> buildings.bin
tools/build_places.py       landmarks, neighbourhood names, spawn points
tools/build_lots.py         car parks, plazas, yards -> lots.png
tools/build_wood.py         which green is woodland -> surface.png's blue channel
tools/build_monorail.py     the monorail's beams, stations, platforms -> monorail.json
tools/extract_rail.py       every rail way and stop in the box -> tools/data/raw_rail.json
tools/build_link.py         Link's two 1 Line tracks and its stations -> link.json
tools/build_freight.py      BNSF's two main tracks, Balmer Yard and its tracks -> freight.json
tools/extract_ferry.py      ferry routes, terminals, slip dolphins -> tools/data/raw_ferry.json
tools/build_ferry.py        WSF's Seattle-Bainbridge route and its two slips -> ferry.json
tools/build_bikepaths.py    cycleways and designated bike paths -> bikepaths.json
tools/build_piers.py        OSM's piers -> piers.json
tools/build_beaches.py      OSM beaches (from raw_green.json) -> beaches.json
tools/build_parkprops.py    benches, picnic tables, playgrounds, fountains -> parkprops.json
tools/fetch_dem.py          downloads the USGS terrain tiles
tools/build_mountains.py    DEM -> the Olympics/Cascades skyline and Rainier's baked face -> mountains.bin
tools/render_map.py         draws the whole graph top-down, for eyeballing
tools/taxicheck.mjs         the taxi fares job end to end, and every way it ends
tools/taxihitch.mjs         the worst single call of finding a fare at 8x CPU throttle (before/after for a search change)
tools/verify.mjs            headless CDP boot + assertions + screenshots
tools/jank.mjs, perfguard.mjs, beauty.mjs, survey.mjs, gait.mjs, flycam.mjs,
  crowdshots.mjs, charshots.mjs, vehshots.mjs, landmarkshots.mjs, bldshots.mjs,
  lotshots.mjs, trafficcheck.mjs ...   see "Verifying"
```

## Pull requests

**Every auto PR title carries the version it ships**, e.g. "Auto v57: ...".
The version is the one fact a bug report always needs and the one thing a
merge list otherwise hides -- and this repo has already shipped two releases
whose version bumps silently did not happen (a sed with no match exits 0).
The title makes a missing bump visible at review time.

## Build number

**`#build` on the launch screen and `CACHE` in sw.js go up together, once per
change** — `v9` next to `auto-v9`. The point is that a player can read the
number off the loading screen and say which build they are on, which is the
first thing worth knowing when a fix appears to be missing: a stale service
worker looks exactly like a fix that didn't work.

They stay two literals on purpose. Sharing one constant means either the page
fetching the number out of sw.js, or sw.js pulling it in with `importScripts` —
and in that second case sw.js's own bytes never change, so the browser has no
reason to install the new worker and the cache never turns over. **The byte
change to sw.js is the update trigger**, so that file has to carry its own
literal. Bump both, and keep the digits equal so a mismatch is obvious on sight.

## Verifying

`node tools/verify.mjs [--shots]` with `python3 -m http.server 8000` running. It
boots the game headlessly, asserts landmark positions against real lat/lon, checks
graph and budget numbers, drives a car, and writes screenshots including two
aerials. `AUTO_PROBE='<expr>' node tools/verify.mjs` evaluates a one-off
diagnostic on the same proven boot path -- use that rather than writing a second
CDP harness, which is how the first one drifted.

It does two things you must keep doing by hand if you write your own: **bypass
the service worker** (`Network.setBypassServiceWorker`) or you will test a stale
build and chase phantom bugs, and set `window.__noAutoQuality = true` *before*
boot or SwiftShader's ~5 fps drops the tier and every screenshot lies.

`window.__dbg` exposes `{ game, city, player, world, traffic, peds, scene,
camera, renderer, controls, audio, pickups, G, THREE }`. Useful moves:

```js
__dbg.game.paused = true;                    // freeze and fly the camera
__dbg.player.enterVehicle(__dbg.traffic.nearestEnterable(x, z, 400));
__dbg.controls.btn.gas = true;               // drive
__dbg.game.addHeat(400);                     // summon the police
```

Note SwiftShader runs at ~5 fps, and `dt` is clamped to 0.06 s, so game time
advances far slower than wall-clock — measure displacement, not elapsed seconds.
Ten wall-clock seconds of walking is only a few metres; don't read that as stuck.

**To walk, send real keys** (`page.keyboard.down('w')`). Assigning
`__dbg.controls.stick.y` does nothing: `read()` opens with
`if (this._stickId === null && ...) this.releaseStick()`, the anti-latch guard
from the stuck-stick fix, so a stick set without a live pointer is zeroed on the
very next frame. This silently reads as "the player can't move."

**`AUTO_PHONE=1 node tools/verify.mjs` boots as the iPhone** (memprobe's UA and
viewport), so the ON_PHONE paths run: arrays dropped after upload, released
texture canvases, far LODs. A desktop run never exercises them, and since v179
the phone drops far more (see "Memory"). Expected on master too: "piers / bike
paths not built when in range" fails, because the deck ray finds nothing once a
pier chunk's arrays are gone (`the deck drawn null m`). Anything else failing
only under AUTO_PHONE is a phone-only bug.

**Every harness takes `AUTO_HTTP_PORT` and `AUTO_CDP_PORT`.** Serve master from a
second checkout on another port (`:8001`) and run the same harness against both
for a real before/after; several agents' Chromes can then share one machine.
Streaming timings (`updateP99`/`updateMax`) on a shared machine are contention —
run master as a control at the same time before believing either.

**`tools/perfguard.mjs` waits for the game loop to draw** (`sceneStats.calls > 0`
and pedestrians present) before measuring. It used to measure the moment
`__dbg` existed and compared an unrendered scene with no pedestrians against a
full one. A fresh worktree has no `tools/data/perfguard.json`, so save a record
from master before `--check`.

The purpose-built harnesses, each a fixed-dt, paused-game driver:

| tool | what it judges |
|---|---|
| `tools/gait.mjs [--trace]` | the stride against published bands, sole contact, the speed ramp (see "The gait") |
| `tools/walkcam.mjs <dir> [walk\|run\|sprint] [side\|chase\|both]` | the player walking on a real street at fixed dt through `player.update`, shot from the chase camera and a side camera every `WALK_STEP` frames. The moving body in context: where the crouched walk was obvious |
| `tools/gait-strip.mjs` | a frame strip of the cycle; forces the player's humanoid visible on the staging point (one boot spawned in a car and shot 12 frames of empty ground) |
| `tools/charshots.mjs [tag] [seed] lineup` | every pooled look plus a cop side by side at 9 m — a single seed says nothing about the pool. Close views `face`, `face34`, `profile`, `profilehead` (0.5-0.85 m, near plane 0.05: the game's 0.5 m cut the face in half), `hands`, `handback`, `grip`, `run`. The sun sits 300 m out: at 12.8 m the subject was inside the shadow camera's near plane and portraits could not show self-shadowing at all |
| `CHAR_VIEWS=a,b` / `CHAR_OPTS='{json}'` / `CHAR_EVAL='<js>'` | limit the views / merge into `makeHumanoid`'s options (a cop, the lightest skin, which no pooled look deals) / run an experiment on the posed subject first (switch off shadows, AO, map) |
| `CHAR_PROBE='face:x,y;x,y\|profile:x,y'` | raycasts pixels back to the part (`geometry.userData.parts`, recorded by `SkinAcc.add(..., name)`) and the BIND-pose point that drew them. The posed idle stands lower than bind, so don't compare posed y |
| `tools/crowdshots.mjs [tag]` | 12 pedestrians, one seed per POOLED LOOK, posed at dt = 0 on a real pavement; seeds `1000 + k*7919` landed on one look and photographed the harness. `CROWD_PROBE=1` prints each person's screen position, placed height, terrain, `roadLift` and what a ray straight down hits — a sunk figure is a disagreement between the ground query and the geometry |
| `tools/pedcheck/harness.mjs <scenario>` | the crowd, as numbers with a `pass` where there is a bar: `density` (people within 40 m at Pike Place / Westlake / Pioneer Sq), `road` (share in a carriageway, crossings apart), `behav` (AI knockdowns, cars held), `flee` (through walls / into water), `cops` (time to BUSTED), `stall`, `overpass`; `look` / `crossing` shoot it. See "The crowd: living streets" in `guide/on-foot.md` |
| `tools/vehshots.mjs <tag> [types] [--street]` | `--street` parks a fixed lineup on the densest commercial street, shot at eye height and raised — a before/after random traffic can't give. The lineup spawns occupied, with a `chase` view on the first near-lane car; `VEH_NEAR=a,b,..` replaces the near lane (put a new type first to get its chase view). Launches through tools/chrome.mjs, so `AUTO_GPU=1` works |
| `tools/viewshots.mjs <dir> [names]` | fixed camera views by bearing/pitch/altitude (`at`/`bearing`/`pitch`/`alt`, or look-at `t`/`c`); defaults are the mountain views; prints the scene pass's draw count; `VIEW_PROBE='<js>'` evaluates once (see "Mountains on the horizon") |
| `tools/landmarkshots.mjs <dir> [views] [--collide] [--kerry]` | world-framed landmark views, per-landmark cost built alone, the collision drive/walk (incl. the downtown landmarks), and `--kerry`: rays from the terrace at the Needle and the skyline (see "Landmarks"); `LM_PROBE` / `LM_PROBE_FILE` |
| `tools/lotshots.mjs <dir> [--probe]` | lot views; `--probe` prints the grass share per region (see "Lots, plazas and yards") |
| `tools/bldshots.mjs <dir> [--scan] [--shots=a,b] [--n=6] [--from=index.json]` + `tools/bldsheet.py <dir> [out] [--pair=<dir>]` | the building outlier scan and per-category contact sheets, eye level off the long (downhill) face plus an aerial; `--from` re-shoots another run's buildings by position for a before/after (see "Buildings: the outlier scan"). GPU by default (`AUTO_GPU=0` for SwiftShader) |
| `tools/stuntjumps.mjs [ids] [--caps] [--shots DIR]` | every stunt jump: corridor check, then the player's car driven off it at fixed dt per speed cap (see "Stunt jumps") |
| `tools/wantedcheck.mjs [--secs 60] [--levels 1,2] [--shots DIR --only van,officer,chase,deploy]` | the wanted levels at fixed dt: a getaway in a sports car at each level held (how long the car lasts, units spawned, peak active against the cap, the helicopter's share, shots and hits), standing still on foot (busted or wasted, when), the cool-down hidden and under the helicopter; `--shots` the SWAT van, the officers, a helicopter chase and a deployed SWAT team (see "Wanted levels") |
| `tools/trafficcheck.mjs [--dump FILE] [--shot DIR] [--sites a,b]` | share of cars against the flow, oncoming contacts, stuck cars and jams over 7 sites at fixed dt, the last a police pursuit (see "One-way traffic") |
| `tools/aidrive.mjs [--sites a,b] [--json FILE]` | how the AI drives, per car per frame at 5 sites (downtown, an arterial, I-5, Queen Anne, Capitol Hill): lane error, weaving, yaw jerk, hard braking, pedal switching, lateral g, speed through turns, off road / left of centre, tailgating, circle contacts vs real body hits, street-object contact and the cars wedged there. `AD_PROBE='<expr>'` / `AD_PROBE_FILE` runs a diagnostic after each site (see "How the AI drives") |
| `tools/crashcheck.mjs [--shots DIR]` | how hits respond, at fixed dt on a flat street: a T-bone (the victim's shove and spin, the striker's speed after), an offset rear-end, head-on, a PIT, bus vs sedan both ways, 30 deg into a wall at 20 m/s, your car's spin ending and steering after, a shunted AI car re-taking its lane; `--shots` the T-bone from above (see "A crash spins and slides") |
| `tools/flycam.mjs [--jitter]` | a scripted flight: camera measured RELATIVE TO THE PLANE and the plane's on-screen motion, since absolute camera movement at 116 m/s is ~2 m a frame regardless. The autopilot holds 45 m over the terrain under AND 400 m ahead, or the bay dive flies into Queen Anne. Also counts building and road pop-ins, and flies `i5high` (see "flycam: road pop-ins") |
| `tools/camtunnel.mjs` | camera height at stations through bores — nothing through the roof |
| `tools/greenshots.mjs <dir> [views] [--stats] [--fly]` | the trees: forested parks, leafy neighbourhoods from the air, residential and downtown streets at eye level; `--stats` the scene pass's draws and triangles and a frustum breakdown by category, `GREEN_PROBE` a one-off diagnostic (see "A green Seattle") |
| `tools/aircraftshots.mjs [dir] [types] [--stage] [--field] [--flight] [--takeoff]` | aircraft on a plain stage (incl. a `close` cockpit view), on their Boeing Field spots, the helicopter flown through spool/lift/hover/yaw/forward/turn/stop/land under the game's chase camera, and fixed-wing take-off numbers (see "The hangar"). `AIR_PROBE='view:x,y'` raycasts stage pixels |
| `tools/jank.mjs` | `fwy-bump`, `crossing-clash`, `barrier-on-road` added for the grading (see "Freeway grading"); `tree-on-road`, `tree-in-building`, and `tree-in-water` / `tree-on-lot` counting trees only, all off the built tree records |
| `tools/junctions.mjs [tag] [--only=cat] [--noshots]` | 19 junctions picked by kind; per junction a raycast classification map, hole / stacked tarmac / crossing paint / kerb gap / sink counts, and oblique, top and eye shots (GPU by default; `JUNC_PROBE='<expr>'`, `JUNC_AT=x,z`). See "Junctions, dead ends, bridges" |
| `tools/shadowcheck.mjs` | the phone's shadow cache against three's own pass: live shadow map read back both ways at seven boxes, depths compared texel by texel, draws counted (see "Heat") |
| `tools/shadowshots.mjs <dir> [--desktop]` | close-ups of the walking player's shadow, his car's, and building shadows on streets, on the game's own sun; `SHOTS_EVAL` / `SHOTS_PROBE` / `SHOTS_ONLY` (see "Smooth edges, and the player's own map") |
| `tools/audiorender.mjs [--only a,b] [--showcase]` | renders the sound offline to `docs/audio/*.wav`: peak/RMS/centroid/silence per file, fails on clipping; `--showcase` refreshes `apps/auto/docs/audio/` (see "Sound") |
| `tools/audioprobe.mjs [--only pause,tank,sirens]` | the mix's acceptance numbers, offline: the world bus muted by a pause (and back), the tank's cannon over its engine, two sirens decorrelated; fails on a miss (see "Sound"). `audiorender` also prints each file's DC |
| `tools/perfcpu.mjs --audio` | lets the AudioContext run and counts the rendered Web Audio nodes per run, persistent and one-shot, and the bank's build time (see "Sound") |
| `tools/meleecam.mjs <dir> [combo\|walkcombo\|aim\|walkaim] [side,chase,front]` | the punch combo / the pistol's aim at fixed 1/60 against a pedestrian standing beside you; `MELEE_PROBE=1` prints the wrists in the body frame per frame and each hit frame (see "Fighting on foot") |
| `tools/hillride.mjs [--types a,b] [--sections ..] [--trace]` | the player's car through `Vehicle.update` down the steepest streets (SW Genesee -23 %, SW Kenyon -20 %, ...), over the sharpest crests at 32 m/s (a per-type table of the pinned 32/-27 % one), through freeway step sites, a made-up step in a flat street and a teleport 2 m under Genesee. Fails if a 12 %+ descent hops, the crest hangs < 24 frames, or a step / teleport launches the car (see "A car follows the ground DOWN a hill" in `guide/vehicles.md`) |
| `tools/ridesurvey.mjs [--tag T] [--at x,z;.. --range M] [--shots DIR]` | every road chain in the city ridden at a class speed through Vehicle.update's vertical follow: frames over 30/60 m/s2, humps, grade breaks, deck captures, per kind and per ranked 60 m site; `--at` traces a site row by row (see "Street grading") |

**A walker needs a seed, and the seed is the edge's own surface.** Seeded with
no reference height, `groundAt` takes the highest deck, so every freeway edge
starting under an overpass began on it and "jolted" off; seeded at terrain under
a 3 m fill it climbed the batter a step at a time (786 of 1356 jolts).
`fwy-bump` seeds from `e.ph[0]`, deck y or terrain; `barrier-on-road` seeds each
sample on its lane's own cambered surface and samples only inside a trimmed
lane's drawn extent — a terrain + 0.3 seed first read 24.3 %, counting the
road's own raised tarmac. verify's deck walks learned the same: compare against
the DRAWN deck, not the chord between node heights, and seed where the walk
starts. `beauty.mjs` hides `#topBtns`, and a view picker that finds nothing must
still return a posed camera (an un-posed fallback gave a NaN camera and a black
frame).

## Offline

`sw.js` follows the repo contract (see the `ruin` app): shell-only fast install,
lazy cache-first for the version-stamped Three.js build with copy-forward across
cache bumps, and URL-based `cache: 'no-cache'` revalidation (WebKit refuses to
`fetch()` a navigation-mode Request). **Bump `CACHE` in sw.js on any deploy that
must invalidate immediately.** Never add `vendor/` or `src/` to `SHELL`: a slow
install is what pins iOS players to a stale worker forever.

**Look up only the current version's cache** (`fromCurrent` in sw.js), never
`caches.match()`: that searches every cache, oldest first, and iOS can kill a
worker before activate deletes the old ones -- v86 on an iPhone loaded a new
`world.js` against an old `util.js` and died with *Importing binding name
'segDist' is not found*. The boot log in index.html reloads once, by itself,
when it sees that kind of error (files from two versions), after the new
worker takes over.

## The one height surface

The heightfield is now **imported** rather than baked from polygon distance
tests, but the law is unchanged and is still the one that bites:

> After boot, every consumer -- terrain mesh, road quads, buildings, cars,
> pedestrians -- reads the same `terrainHeight()`.

**It is not bilinear any more, and the importer never got the message.**
`terrainHeight()` interpolates the way the terrain MESH is triangulated, because
a bilinear query over a triangulated mesh disagrees by `(a + d - b - c) / 4` and
that is what grass growing through the road was. `tools/build_roads.py` still
bakes node heights with a bilinear sample, and its `terrain_at()` docstring
still claims *"Bilinear, matching geo.terrainHeight() exactly."* — which is now
false. Measured: **55,282 of 64,170 nodes (86 %) carried a wrong height, worst
by 6.63 m.**

Ground nodes therefore re-read their height from `terrainHeight()` at load, in
`cityGenerator`. Elevated nodes keep their baked value — that is a deck, not the
ground under it. Done at load rather than in the importer for the same reason
`roadFit()` is: the correction travels with the geometry and cannot go stale
against a re-import. `cityStats.nodesReheighted` / `worstReheight` report it.

Note this did **not** move `sink` (11.8 % -> 11.82 %): `meshRoad` draws strips
from `terrainHeight` directly and only uses node `y` for its bow/grade
subdivision heuristics. It is a correctness fix for the invariant above, not a
fix for anything visible, and shipping it as the latter would have been a lie.

`height.png` is 781x781 at 40 m (31.2 km / 40 m, +1), with the vertices near streets fitted to the streets (see "Street grading"). **That spacing is not free to change**: it is
also the terrain mesh's vertex spacing, and the two have to agree. A finer query
grid floats roads over bulges the mesh doesn't resolve; and at 20 m the mesh
would cost ~3.4 M triangles across the 26 km map, several times the whole frame budget.

Bridges and freeway decks are separate: `city.groundAt(x, z, currentY)` returns
the deck NEAREST `currentY` within `DECK_REACH` (0.9 m above it), else the
terrain. It used to take the *highest* deck within 2.6 m, which is taller than a
car -- see "Freeway grading" for the 3.76 m drop that caused. With no `currentY`
(a spawn or a placement query) it still takes the highest, which is the only
sane answer without a reference height.

**Ground-level freeway is a deck to `groundAt` too.** Every graded edge — deck
or ground freeway/ramp — registers one deck surface per ~5 m sample of its
profile, and `roadLift` answers only the embankment (batter) off it. So the
re-reheight above applies to draped roads only: **a graded node's `y` is the
road surface** (surface - 0.09, as decks always were), set by `gradeRoads`,
not the terrain under it.

**Paved surfaces sit above the terrain and everything standing on them has to be
lifted by the same amount.** `ROAD_LIFT` / `NODE_LIFT` / `WALK_LIFT` in
citygen.js are the single source of truth, shared with world.js.
`city.roadLift(x, z)` reports the lift at a point; `groundAt` takes it as an
optional 4th argument because vehicles sample the ground seven times a frame and
the edge scan is too expensive to repeat per wheel. Forgetting this is what
buried every car 22 cm into the asphalt.

**All three lifts have to be reachable from `roadLift`, not just the two the
strips use.** Junction squares are drawn at `NODE_LIFT` and they overlap the
ends of every strip that meets there, so `roadLift` asks `nodeLift` first and
takes its answer outright -- a point inside the square is standing on the square.
Maxing it against the strip scan instead gets both signs wrong: junction centres
came back `ROAD_LIFT` and sat 3 cm *inside* the asphalt, and the corners of the
square came back `WALK_LIFT` and floated 19 cm *above* it.

Sidewalks stop short of each junction (`nodeRadius`) and the corner is filled by
a ring drawn in `meshNode`. **That ring needs its own entry in the lift lookup
too.** It sits outside the junction square, and its diagonal corners are past the
end of every strip that meets the node, so the edge scan finds *nothing* there
and returns a lift of 0 -- which dropped anyone standing on a corner the full
44 cm through the pavement. `nodeSurface()` reports the ring as well as the
square, but the two are used differently: the square **overrides** the scan (it
is the top surface there), while the ring only fills in where the scan came back
empty, because along a road direction the strips overlap the ring and know better.

### Pavement verges

**A pavement is a flat slab and then a 1 m verge down to the ground.** It is
drawn flat to its outer edge at terrain + `WALK_LIFT` and comes down across
`VERGE` (1 m for 52 cm, ~27 deg; exported from citygen) in `world.meshVerge`,
for strips and junction rings alike. `roadLift` reports the same slope off a
strip, `nodeSurface` off a ring's band (by max(|lx|, |lz|)), so walking off the
pavement is a slope and not a fall. The verge's lip follows the slab's own edge
chord, so the two cannot part, and it is not drawn over a carriageway, into
water or into a cutting.

It used to be an open 52 cm step: a pedestrian on the grass beyond was correctly
on the ground and, seen across the slab from eye height, sunk to the waist.
**And the query disagreed with the drawing twice over.** `roadLift` tapered
the pavement to zero across the slab's last `RAMP` metres while the slab was
drawn flat to its edge -- a 26 cm sink over the outer half metre -- then stopped:
the 52 cm step. The taper also HID a second disagreement: a pavement lying over
ANOTHER road's carriageway reported `WALK_LIFT` there, 22 cm over the drawn
tarmac, although `meshRoad` drops that pavement piece. Neither pavement nor
verge lifts a point on another road's carriageway now (`onCw`, segment interior
only -- past an end the clamped distance is a round cap, which the junction
square answers for). **jank `sink` 295 -> 99.**

verify's tunnel-lift check had to learn the verge: its "is anything but a
tunnel covering this point" radius grew by `VERGE` (hw + 4.4 along an edge,
(hw + 4.2) x 1.45 round a node), or it counts every verge as a bore lifting
bare ground.

## Water, and the law that keeps being learned one caller at a time

**Every height test is against the LOCAL water surface**, because Green Lake is
at 50.3 m and Lake Union at 5. `world.waterLevelAt()` exists for this. The
on-foot path learned it; `updateDrive` did not, and its test was
`v.y < -1.2 && G.isWater(...)`, which only ever describes the sea. So a car on a
lake bed never tripped anything and **you could drive the bottom of Green Lake
at 200 km/h, dry and at full throttle**. Driving now samples the local surface
before the step, cuts the engine, drags the car down and sinks it. Verified at
Green Lake (surface 50.3, bed 43.4) and in Elliott Bay (surface 0, bed -5.4):
200 km/h -> 0 in both.

The lesson is not about water. **When a law is added, grep for every caller of
the thing it replaces** -- this one sat one function away from the code that
documented it, for as long as the game has had lakes.

### Every water-level test, again: the cuttings' water mask

The depth-only mask that keeps water out of a dug cutting (`portalCuts`,
`tunnelWaterMask`) was sea-level only. It stood at 0.02 m and covered floors
under ~1 m. The 520's cutting at the Montlake lid's east portal lies inside
Lake Washington's box with its floor at ~4 m, so the lake's 5.09 m plane lay
across both carriageways. Each mask quad now stands at `G.drawnWaterLevel()`
(the highest plane drawn at that point: the sea, any lake box, the canal), and
the "is this low enough to need one" tests use the same level.

**verify walks every road against the water drawn over it** ("roads under
the water"). It computes the drawn level itself and counts a sample only
when nothing hides the water there: not the cuttings' mask, not ground over
it, not a lid or deck overhead. The 520 and I-90 corridors must be dry, and
each floating bridge must be found and clear the lake by 3 m. Master before
this fix failed with 14 samples on the 520 and Evergreen Point at 0.61 m.
Everything else is held at its count (see "Known gaps"), so nothing new goes
under. **verify also used to end with `process.exitCode = bad.length ? 1 : 0`**,
which cleared every FAIL above it whenever the console was clean. Only ever
set a failure.

## Geometry building

`Builder` (build.js) accumulates positions/normals/uvs/colors and emits one
`BufferGeometry`. **`quad()` and `tri()` auto-correct winding against the supplied
normal** — this exists because hand-wound horizontal quads were backface-culled,
which made every road surface in the city invisible while the sidewalks (wound
the other way) rendered fine. Don't "optimise" that check away.

**`Builder.box(..., rot)` turns the OTHER way from three's `rotation.y`**
(its local x is (cos rot, sin rot)): to face a box along a heading `h`, pass
`-h`. The Needle's viewers and the fishing rod's stand were built with `h` and
stood skewed until v129.

`mergeByMaterial()` flattens a group of static meshes into one mesh per material;
landmarks would otherwise cost hundreds of draw calls.

## Vehicle asset table is `assets`, never `t`

`Vehicle.assets` holds the shared geometry for a type. It used to be
`this.t`, and `traffic.js` spawning a car did `v.t = t` with the car's position
along its edge — replacing the whole geometry table with a number. Nothing
noticed, because the meshes were already built in the constructor and
`this.t.wheelR` fell through to a default. It only surfaced when you got in:
`setDetailed(true)` iterates `assets.wheels`, so **carjacking any moving traffic
car threw**, and it threw *after* `this.vehicle = v` but *before*
`this.onFoot = false`, leaving the player half in the car. The HUD read the
car's speed while the sim still ran the player on foot, which is what "frozen
but the speedo works" was.

Parked cars were fine, which is what made it look intermittent — they spawn
through a different path that never wrote the field.

Two things follow. Don't give a shared, long-lived reference a one-letter name.
And when a bug report says a system half-works, suspect an exception midway
through a setup function rather than a stuck value: `requestAnimationFrame` is
re-armed at the top of the frame, so a throw part-way through leaves the loop
running with an object in a state no code path expects.

## Input lifecycle (never latch a held pointer)

`pointerup` is not guaranteed. iOS steals the gesture at a screen edge, an
overlay can open under the finger, and a captured element that gets
`display:none`'d on a mode switch drops its pointer silently. The rule:

- **No input path may refuse a new press because an old one is still "held".**
  `onStickDown` used to `return` when `_stickId` was set, so one missing
  `pointerup` latched the stick at its last deflection *and* made it impossible
  to ever grab again — the reported "stick stuck in one direction". Last touch
  wins instead.
- Held presses listen for `lostpointercapture` as well as `pointerup` /
  `pointercancel`; that is the event you actually get in the failure cases.
- `setMode()` clears every button, because switching foot/drive hides the button
  set that may be under a thumb (exiting a car with GAS down stuck the throttle).
- `blur` / `pagehide` / `visibilitychange` call `resetAll()`.

Backgrounding has the same shape of trap one level up: **pause through
`setPaused`, never by assigning `game.paused`.** `visibilitychange` used to set
the flag directly, which stopped the world without showing the pause menu, so
returning from the home screen looked exactly like a hung game — the only way
out was the pause button, which is not what anyone taps on a frozen app.
`setPaused(false)` also calls `audio.resume()`, because iOS suspends the
AudioContext on the way out and does not hand it back.

Regression test — dispatch synthetic `PointerEvent`s and simply never send the
`pointerup`, then check a fresh press re-acquires:

```js
const z = document.getElementById('stickZone');
const ev = (t, id, x, y) => z.dispatchEvent(new PointerEvent(t,
  { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
ev('pointerdown', 1, 100, 300); ev('pointermove', 1, 180, 300); // stick.x === 1
ev('pointerdown', 2, 100, 300);                                 // must re-grab
__dbg.controls.stick.x; // must be 0, and _stickId must be 2
```

## Heading sense (the sign trap)

`heading` is literally a three.js `rotation.y`, so **forward = `(sin h, cos h)`**
and heading `0` faces `+Z`, which in this world is *south*. That makes the sim
consistent with the models (a car's local `+Z` is its nose) but it has one
consequence that is easy to get backwards:

> **A larger heading rotates anticlockwise — i.e. it turns LEFT on screen.**

So anything converting a screen-space or compass-space intent into a heading has
to flip the horizontal sign. The three places that do:

- `player.updateDrive`: `steer = -input.x`.
- `player.updateFoot`: `Math.atan2(-input.x, -input.y) + camYaw + PI`.
- `hud`: minimap rotates by `camYaw` (not `-camYaw`), the minimap arrow uses
  `camYaw + PI - heading`, and the north-up full map uses `PI - heading`.

`util.dirDeg()` is the *other* convention (compass bearing, `0` = north,
clockwise). It is only used for district grid axes in geo.js — never for an
entity heading. Don't mix them.

The minimap's **north tick** falls out of the same rule. The map image is drawn
world-aligned and then turned by `camYaw`, and north is `-Z` (heading `0` faces
`+Z`, which is *south*), so north lands at `(sin camYaw, -cos camYaw)` from the
centre — the direction that was straight up before the rotation. It's drawn
outside the rotated transform so the letter stays upright at any bearing. That
expression is the same one a blip at `(p.x, p.z - d)` resolves to, which is the
cheap way to re-check it if the map transform ever changes.

To check a change, don't reason about it — measure. Project a world point to
NDC and see which side of the screen it lands on:

```js
// facing heading 0, world +X must land at NEGATIVE ndc.x (screen left)
new THREE.Vector3(p.x + 30, p.y + 1, p.z + 40).project(__dbg.camera).x
```

## The spawn and the touch zones (v158)

**You spawn on 5th Ave N by Roy St, ~440 m north of the Needle, looking at it** (`SPAWN_LL`
in `tools/build_places.py`, `spawn` in `places.json`; the heading is computed
to face the Needle). The old spawn at 5th Ave N & Broad St also faced it, but
at 230 m, with a building on the corner in the way, and closer than ~400 m the
top house is above the frame of a level chase camera. The spot was chosen by a
line-of-sight search (every street node 400-700 m out, clear to the Needle at
25, 70, 110 and 158 m over its base, past every building box) and then by
looking at the frames. **A red sports coupe is parked at the right-hand kerb
~14 m ahead** (main.js), in the opening frame; the nearest kerb slot, which it
used to replace, was beside or behind the camera.

**The stick is the left third of the screen, full height; everything else
drags the camera** (`#stickZone` / `#lookZone` in index.html). The stick
zone was 46 % wide, so a press just left of centre meant to look put the stick
there. The minimap and buttons sit above both and keep their taps.
