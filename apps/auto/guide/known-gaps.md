# Auto: Known gaps

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Known gaps

- **Roads still under the water drawn over them: 36 deck/freeway samples and
  168 street samples** (verify's ceilings). v153 fixed the big one: a lake's
  plane covered its whole bounding box, and Lake Washington's is 25 km tall,
  so Tukwila's Duwamish valley and bits of Bellevue's and Kirkland's shore
  were drawn under a lake 4 km away (parked cars and all). Each lake is now
  its own water (`G.lakeMask`: the largest connected wet body in its box on a
  20 m grid, grown 40 m for the drawn shore), and the plane, `waterLevelAt`,
  `drawnWaterLevel` and citygen's `standY` all read it. What is left: shore
  streets inside that 40 m margin whose ground the DEM has below the lake,
  and short decks whose end nodes sit on a shore the raster dug as bed (the
  East Duwamish Waterway Bridge's end, Harbor Island's ramps, the ferry
  docks) -- their ends are anchors pinned to draped streets on the same dug
  ground, so the ground itself has to come up. Point Monroe (Bainbridge) is
  a spit the DEM has below sea level.
- **Nobody rides the monorail with you, and its terminal interiors are not
  walkable** beyond Seattle Center's platforms and ramp. (Its doors, and
  Link's, show open while a train stands at a platform: v155.)
- **The rebuilt downtown landmarks are shells** (`src/lmdowntown.js`): no
  interiors, and several numbers are est. -- which platform of the Central
  Library leans which way, the Arch's roof vaults (OSM gives the plan, not the
  roof), the Locks' wall-top height and the exact z of each wall (the OSM
  buildings fix the stack, not the chambers). The Locks' chambers are the
  10 m water mask, so a boat can be taken into the large lock and the
  intermediate gate stands across its middle at the fresh/salt step. The
  Arch has no wall pieces where I-5, its ramps and Convention Place's
  passages meet its footprint at road level (they are dropped so a car is not
  stopped by nothing), and no portal or passage is drawn there: you drive into
  a plain facade line that simply has a gap in its collision.
- **The Queen Anne Counterbalance streetcar has gaps** (see "The Queen Anne
  Counterbalance: Route 26"):
  - Its livery is a period guess, because the 1940 photographs are black and
    white.
  - Its ends are stubs, not McGraw's wye and the downtown loop, and the line
    stops at Cherry St rather than S King St.
  - Nobody waits at the stops or rides with you. Riding, you stand on the
    step frozen in an idle pose: there is no grab-rail arm.
  - The DEM's 40 m cells make some blocks of 1st Ave and Galer St 10-13 %
    for a few metres, so cars crawl there.
- **No Kenmore Air Harbor.** The real floatplane base at the north end of Lake
  Washington (47.756 N) is ~0.5 km past the map's north edge (47.752 N).

- **Freeway over freeway at interchanges stays as imported.** 110 of the 154
  refused overpasses; see "Don't dip a graded freeway under a ramp". They are
  most of what `barrier-on-road` still finds (another carriageway's tarmac
  over a lane), with 15-26 deg overlaps the split-level pass does not treat.
- **The contract probe still finds ~1 % of graded samples 10 cm+ off the drawn
  deck** at the densest interchanges (18 of 1655 at I-5 downtown, 24 of 3417 at
  I-5 / I-90). Mostly decks stacked ~1.1 m over another deck, left as imported
  (the probe's ray from y + 1.2 hits the deck above the car), plus a few
  junction-square and anchor cases at locked decks. See "What you drive on is
  what is drawn".
- **`survey.mjs` poses its eye-level camera from the node-height chord + 1.9 m**,
  which on a graded deck is not where the road is, so eye-level deck shots
  float. Kept so before and after share framing.
- **SR-99 is not to scale.** The NB deck runs 6.6 m under the SB one and bottoms
  at -17.6 m under SODO; the real bore is far deeper (64 m under Virginia St).
  The game box is 14 m wide (OSM hw 7) against a real 9.8 m roadway, and it is a
  box section, not the circular bore.
- **I-5 Express ramp cuttings slice its bore**: portalcheck's 4 sliced-bore
  samples are all the Express, at (569,-184)/(577,-212) and (513,77)/(514,66).
  Pre-existing; the old plan-only `inCut` hid them. **It stays because it is a
  profile problem, not a trench-floor one**: at (513,77) the ramp cutting's OWN
  ROAD runs 0.3-1.2 m inside the Express roof (ramp deck ~5.7 m over the
  Express deck, bore box 5.7 m), so no floor clamp can clear it. Clamping the
  trench floor onto the bore roof was tried and reverted: it fixed one sample,
  moved the slice to (514,66), and put ground 0.5 m over four corridors'
  carriageways (portalcheck). The fix is to drop the Express or lift the ramp
  there; (569,-184)/(577,-212) are the same class. The bore-joint fix did remove
  the dotted seams visible in the Express at that spot.
- **Wrong-way SR-99 rides pass only because the harness dodges** and keeps the
  car alive; cars collide as 4 m circles, so any head-on in a 2-lane bore is a
  hit.
- **meshPortalWall's "FACE THE APPROACH RAMP TOO" loop is dead code.** It reads
  `this._pcutBy.get(m.ni).apron`, but `_pcutBy` maps a node to an ARRAY of cuts
  since "one cut per branch", so `.apron` is always undefined and the loop has
  drawn nothing since. Found during the lid work and not fixed: iterating the
  array would bring back walls nobody has looked at since, so shoot the
  approaches before and after rather than just reviving it.
- **The express lanes only run northbound**, because the import drops
  `oneway=reversible` (see "One-way traffic").
- **Obstacles in dug pits wedge traffic** (posts beside lidded ramps, the I-5
  express portal near (520, 0)). Out of sight the car is recycled; in view it
  stays stuck.
- **Far roads still pop in during take-off, and double up on bends.** All 34
  of flycam's remaining road pop-ins (48 km) happen before the far layer's gate
  opens at 45 m. And an edge's end pieces reach over their node to cover a
  junction's square and a bend's outside corner, so at a bend two edges'
  pieces overlap on the inside.
- `tunnelride.mjs`'s `flow()` checks `oneway` before `onewayRev`, so it treats
  the 2 `oneway=-1` edges as a -> b. None is on SR-99.
- **Piers** (v155, `src/piers.js`): every pier OSM maps (`tools/build_piers.py`,
  ~15 s) over 150 m2 (or 25 m of walkway), mostly over water, not already
  built and with no road on it, is a deck on piles -- 1288 of them, ~350
  outlines -- level with the shore it leaves (0.5-4 m over the water),
  walkable (6 m platform squares; a walkway's segments). Buildings over the
  SEA with nothing under them get a deck too (Smith Cove's Pier 90 is only
  its sheds in OSM). 1 km chunks within ~1.7 km: +1 draw on the waterfront.
  ~0.6 % of deck samples stand on another, overlapping pier's height. Still
  hand-built: the Great Wheel's, Pier 66's and the Aquarium's decks (with
  their gangways), the marinas' floats; the ferry terminal's vehicle lanes
  are roads.
- **Stadium interiors are unreachable** — walls run round the whole footprint,
  with no gates (the arena's hockey game is a screen you enter at its doors). T-Mobile's roof is modelled open and does not move.
- **The minor landmarks are the old models** (aquarium, ferry terminal, Pier 66,
  library, convention centre, locks, Kerry Park): physically shaded and solid
  now, but not rebuilt. Gas Works and the Alki statue were rebuilt in v118.
- **Park paths are not drawn.** OSM maps every trail (Discovery Park's Loop
  Trail, Green Lake's path), but the lot layer's 14.4 m coverage field
  cannot hold a 2 m path, and ribbons need the road mesher's terrain
  subdivision. Pitches are lawn with no markings.
- **The Pioneer Square pergola's orientation is est.** (no OSM footprint): its
  long axis runs north-south.
- **Lot edges come from a 14.4 m coverage field**: corners round off at ~7 m and
  a lot under ~10 m wide (one aisle, a narrow forecourt) thins or vanishes.
  Striping ignores the aisles OSM draws and is phase-anchored in world space, so
  a first row can start mid-bay at its kerb. Untagged Belltown/SLU blocks
  (no landuse, `building=yes` under 1000 m2) still read as lawn, and aprons are
  an inference: a big church or apartment block gets a concrete ring.
- **Buildings are oriented boxes**, not polygons — see "How accurate it actually
  is" for why that was the right trade, but it does mean a curved facade or an
  L-shaped block is squared off.
- **997 buildings (0.8 %) stand over water.** Most are real: Lake Union's
  houseboats, the Alaskan Way piers, Harbor Island. Not worth a filter that would
  also delete the real ones.
- **Faint vertical hairlines in the mountain band at a telephoto zoom.** Under
  Rainier, at fov ~7-14 deg from Kerry Park, the haze band shows 1-2 px
  hairlines of at most ~2 grey levels (invisible at the game's own fov). Ruled
  out (v206): the band's mesh segments (720 -> 2880 left them in place), the
  baked skyline's one-column needles (a 3-column median re-bake changed 793
  columns and not one line), the shader's per-column slope tilt (`dH`, off: the
  same lines), and the sky dome (`VIEW_PRE='__dbg.world.mountains.visible=false'
  node tools/viewshots.mjs <dir> mt-rainier-close`: none). They are fixed in the
  world and sub-column wide; the next suspects are the value-noise hash's
  float precision at large `s` and the face texture's edge texels.
