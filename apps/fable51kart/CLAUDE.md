# Fable51 Kart — CLAUDE.md

The ambitious successor to Fable Kart (`apps/fablekart/`, which stays untouched):
a **true-3D** kart racer, four hand-designed maps, 8 humans online. One
self-contained `index.html`, Three.js **r128** from cdnjs, landscape iPhone PWA.

## ⚠ Version bump — EVERY PR

Increment `APP_VER` in `index.html` once per PR (title screen, bottom-right).
It is folded into `NET_VER`, the online version gate — two builds never share
a room. Bump `CACHE` in `sw.js` (`fable51kart-vN`) when a deploy must reach
installed players promptly (sw.js follows the Wreck & Ruin shell-only pattern).

## ⚠ Verify by rendering, not by reading

```
python3 -m http.server 8000 &
node tools/f51verify.mjs [trackIdx]   # autopilot laps on every map, shots in tools/data/f51shots/
node tools/f51repl.mjs "expr" "shot:path.png" …   # ad-hoc CDP driver (?dbg=1 exposes window.__f51)
(cd worker && npx wrangler dev --port 8787) &  node tools/f51online.mjs   # host+client race over the local worker
node tools/f51icon.mjs                 # regenerate the Home Screen icons from gen-icon.html
```

`__f51` (only with `?dbg=1`) exposes karts/player/TRACK/loadTrack/simTick/…;
`window.__freeCam = {x,y,z,tx,ty,tz,fov}` overrides the camera and
`window.__hold = true` freezes the real-time sim so poses can be staged.
Stepping `__f51.simTick(1/60)` in a loop runs a race in seconds — the verify
tool races 1 lap per map that way and reports finishes / respawns / times.
SwiftShader renders Lambert washed-out; lighting values are tuned for phones.

## Engine (what makes it 3D)

- **Track = directed graph of spline edges** between nodes (`TRACKS[i].nodes`
  / `.edges`, centripetal Catmull-Rom, ~3u samples). Forks and merges are just
  edges; `short: true` marks AI shortcuts; `elev: true` forces a bridge where
  the road leaves the ground; `kickers` raise a ramp, `gaps` delete road (jump
  or fall), `tunnels` enclose a section. A mid point with `y: null` rides the
  smooth terrain. Fractions (`f`) are of edge length.
- **Terrain** is analytic + seeded noise (`terrain.feats` gaussians, `plats`
  flat-topped islands) and is *carved* to every ground-road sample (34u
  aprons). Bridges/tunnels/gaps never carve. The same function drives the mesh
  and the physics.
- **Surface query**: `roadSurface` (XZ hash + Y window, highest deck not above
  you) then terrain — stacked roads coexist. `groundInfo` prefers a found
  bridge/tunnel deck outright.
- **Elevated = bridge**: auto-detected road-over-road (>9u within 16u XZ) or
  forced. Decks get skirts, pillars and continuous ribbon guardrails. **Walls
  are physical wherever a guardrail would be drawn** (`markWalls`: bridge, or
  the ground drops >6u beside the road) but apply only to the deck you are
  tracked on and never in the first/last 44u of an edge (fork throats overlap
  other roads; this was the "stuck at the three-way fork" bug).
- **Interchanges are synthesized, never hand-slapped.** In `buildTrack`, a
  non-main branch leaving a fork gets a parallel lane beside the trunk
  (38u, its outer edge on the trunk's edge) and peels away by 98u; merges
  mirror it; sibling branches stack outward by their widths; designer mids
  within 110u of the node are dropped. `snapThroats` makes a branch ride its
  sibling's surface height while they overlap, the width funnels (`sm.w`)
  open a narrow road out to the trunk's width, a **22% grade limiter** eases
  every climb (kicker lips excepted) and `buildRoads` fills the gore wedge
  with asphalt. `sm.shared` (another non-collinear road within 22u, or a
  wider road under a merged lane) turns off rails/curbs/lamps/posts so nothing
  cuts across a throat. `rawMerge`/`rawFork` on an edge opts out (the Sky
  cable run merges onto the corkscrew straight by hand).
- **Physics**: Fable Kart constants verbatim (SIM_DT 1/60, MAX_SPEED 92,
  ACCEL 48/0.55, BOOST_CAP 138, TURN_BASE 2.4/FADE 0.28, MKDS drift +
  one-shot `grantBoost`, no spinouts) on a surface-plane vehicle with slope
  gravity (`SLOPE_ACC`, `UPHILL_MUL` 1.4, downhill cap bonus). Launch only
  when the ground really falls away (`drop > 2`) — a banked bend once read as
  a crest and threw karts over the wall.
- **Progress** is route-robust: `remAtEnd` per edge (reverse relaxation),
  gates granted on edge *transition*, ratcheted per lap, reset on rescue.
  Rescue = last good road sample, backed off past any kicker (+75u) so a
  failed jump never respawns you in front of the same ramp with no run-up.
- **AI**: per-sample corner cap closed-form from the steering model
  (`sm.cap`, margin 0.86; curvature is rad/u — the inherited ×2 bug made AI
  crawl), route planning by `daring` at forks, gives up on a shortcut after
  two rescues on it (`ai.fails`), lines up straight before gaps, seeks pads
  and boxes, bounded rubber band from `DIFFS`.
- **Items**: Fable Kart's seven + **Comet Dash** (auto-aimed 150 u/s dash,
  invulnerable, bonks what it touches). Projectiles ride the graph
  (`trackProjectile`) and hug the surface, so rockets cross bridges and tunnels.
- **Drivers** are rigged (seat → torso → head / arms): steer, lean, tuck,
  glance, blink, gasp, flail on bonk, arms-up in big air, victory / slump.
  Everything render-side in `syncKartMesh`.

## Maps (each with its own scenery kit in `SCENERY`)

1. **Summit Run** — lake fork (horseshoe vs dirt saddle), tunnel on the climb,
   crest jump beside a waterfall, 360° helix around the Elder Tree spire (the
   road crosses itself), viaduct over the start straight, alpine village,
   gondola, cows.
2. **Neon Harbor** (night) — rooftop run with a gap between buildings vs the
   boulevard, neon tunnel under the plaza, 1¼-turn parking-tower spiral,
   suspension bridge with a raised drawbridge gap, searchlights, harbor.
3. **Ember Caldera** (dusk) — flank climb, caldera rim shortcut with a lava-
   channel jump, lava tube tunnel, figure-8 flyover, eruption lava bombs on a
   seeded schedule, ember column, lava falls.
4. **Sky Citadel** (dawn) — sky bridges over a cloud sea, THREE-way fork
   (courtyard / gallery tunnel through a procedural castle / boost-pad cable
   run with a void gap), full-turn corkscrew around a spire, chasm bridge with
   a second gap, airship, windmill, waterfalls.

Nothing is ever placed on the racing surface: `offRoad()` / `postClear()`
measure XZ distance to every road at any height (a 3D check once let trees
land on mountain roads). **Enforcement:** `__f51.roadAudit()` samples every
world vertex *and triangle edge* against the drivable corridor (|lat| < w,
road y − 0.5 … + 4.5, kicker lips excepted) and must return `[]` on all four
maps; `node tools/f51sweep.mjs` autopilots each map on every route and tiles
contact sheets in `tools/data/f51shots/sweep/` for an eyeball pass. Rooftop
buildings, cranes, suspension cables, castle corners, island cones and lamp
posts have all been caught by these — run them after any scenery change.

## Online (8 players)

`Fable51Room` DO on `/f51/rooms` (worker), an 8-seat copy of the Fable Kart
relay. Netcode is Fable Kart M1+M2 ported: host-authoritative race, WS relay +
WebRTC fast path, client-authoritative pose (`p` = x,y,z,θ,speed,grounded,
driftDir,boost,up,edge), items/laps/ranks host-decided, rising-edge boost
adoption (never `Math.max` an echoed timer), mid-race rejoin by name. The host's
`TOTAL_LAPS` rides the start message. Duplicate driver picks auto-resolve.

## Music / audio

All WebAudio synthesis. `SONGS` = one `composeSong` per map + the paddock
loop: hand-written 12-bar leads, bass/arps/stabs voiced from the chord chart,
per-song drums. Menu music starts on the first interaction; race music on GO.
