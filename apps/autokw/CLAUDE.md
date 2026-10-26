# Auto KW

**Auto KW is a fork of `apps/auto` set in Waterloo Region, Ontario**: Kitchener,
Waterloo, Cambridge, St. Jacobs, the airport and the countryside between, a
31.2 km x 31.2 km square (`MAP_HALF` 15600) centred at 43.452 N, 80.475 W.
It shares no code with `apps/auto` at runtime: it is a copy, customised. The
guide files below are Seattle's and mostly still true of the engine; where this
file and a guide disagree, this file wins.

## What is different from Seattle (read first)

- **The import is `tools/kw/`**, a copy of the Seattle tools with KW paths
  (`tools/kw/data -> tools/data/kw`, output `apps/autokw/data`). Re-run:
  `cut_extract.py` (Ontario .pbf -> the box, once) then `osm_extract.py`,
  `build_raster.py`, `build_roads.py`, `build_buildings.py`, `build_places.py`,
  `build_lots.py`, `build_wood.py`, `build_beaches.py`, `build_parkprops.py`,
  `build_bikepaths.py`, `build_piers.py`, `build_hwy.py`, `build_junctions.py` (all with `tools/.venv/bin/python`).
- **A road segment under 4 m (`MIN_SEG`) is merged, never dropped**
  (build_roads.py `merge_slivers`): its two ends become one node (one an
  edge already used; the other stays in roads.bin unused, so every node and
  edge index is what it was). Dropping it alone cut the way in two -- 616
  places where a street ended in two dead ends a few metres apart, cars
  U-turning into each other (Union St E by Lucan Ave). Graph quality, before
  -> after: components 168 -> 21, dead ends inside the map 1867 -> 935,
  stranded nodes 729 -> 60.
- **Heights are ELEV_BASE (250 m) below sea level-referenced DEM heights**
  (`tools/kw/proj.py`), so the ground sits at ~5-175 m in the game as Seattle's did.
- **There is no sea.** Water is ONE FIELD: `data/wlevel.png` (same encoding as
  height.png, 0 = none) gives the surface at each 40 m vertex, flat over lakes
  and sloping down the Grand and Speed rivers (~78 m across the map).
  `geo.waterLevel(x, z)` reads it, `world.waterLevelAt` = that where the water
  is wet or drawn, and `world.buildWater` draws one mesh over every cell with
  water at a corner. `water.json`'s `lakes` is empty on purpose.
- **Storage is prefixed `autokw-`** (localStorage, sessionStorage, the boot
  cache's IndexedDB, the SW's caches). The two games share an origin: an
  `auto-` key here would read Seattle's saves and boot cache.
- Seattle-only systems are switched off in main.js (monorail, Link, BNSF --
  KW's own heavy rail is kwrail.js, below --
  the Counterbalance, the ferry, the islands, orcas, Seattle's venues and
  minigames); their modules are still in src/ for reuse.
- Verify with `node tools/kw/kwshots.mjs <outdir> [views]` (AUTO_GPU=1 for the
  GPU; `VIEW_PROBE='<js>'` evaluates once). It is tools/viewshots.mjs pointed
  at apps/autokw/, plus a `player: true` view (the game's own chase camera).

## Auto KW's own layer (read before touching these)

- **src/kw.js** + `data/kw.json` (tools/kw/build_kw.py): named buildings ->
  their boxes (`bd.kw`), real looks (`LOOKS`, read by world.buildingFamily),
  low commercial boxes as strip plazas (`world._stripMall`), schools /
  campuses / arenas / civic buildings / the two plazas drawn from their OSM
  POLYGONS (`buildPolys`; their box goes flat, h 0, and each wall is a
  solid), every sign (Tims, FreshCo, storefronts in the zones, nameplates,
  `LM_SIGNS`), Oktoberfest bunting, St. Matthew's and St. David's grounds.
  All are landmarks.js extras (`addLandmarkExtra`), merged into its clusters.
  **The landmark merge keeps vertex colours now (build.js mergeByMaterial);
  author vertex colours in linear (pow 2.2 of sRGB).**
- **Stores:** `tools/kw/kw_stores.json` is the official Tim Hortons and
  FreshCo lists (Oct 2026), authoritative over OSM.
- **The importer packs building rotation in the GAME's sense**
  (build_buildings.py): min_area_rect's rot puts w along (sin, cos), the game
  along (cos, sin). Seattle's tools/build_buildings.py has the same mismatch.
- **src/chicopee.js** (data/chicopee.json): runs, lifts, chairs, bikes, downhills.
- **src/ykf.js** (kw.json `aero`): YKF's pavement, `city.slabQuery`,
  `world.inAirfield`; the field is graded in build_raster.py `grade_ykf`.
- **ION is Seattle's link.js engine** on `data/link.json` from
  tools/kw/build_ion.py, made ION's: the car, stations, track, catenary,
  crossings and timetable are in "ION, as it is" below.
- **src/kwfun.js** (v11): the St. Jacobs market's tent and Market Sports'
  dome (their boxes get `kw.skip`: world.js and buildPolys draw nothing for
  them), Canadian flags (kw.json `flags` from build_kw.py; one material whose
  vertex shader waves them, `waveFlags` each frame; a small flag's cell is a
  'flags:' cluster, drawn within landmarks.js `FLAG_RANGE`), KW Surplus (the tank on
  its lawn: TANK_SITE is overwritten at boot; a static Spitfire model on its
  roof), Parkway Ford Lincoln's showroom, signs and the cars on its lot, and
  `openGround` (the balloon's field by the market). Pin Up Arcade Bar
  (arcade.js) and AOK's OKTOBERFEST pinball (pinball.js) are Seattle's venues
  moved; arcade.js `streetFace` can hang a storefront on a footprint building's
  real wall (kw.js `polyFaces`).
- **The headless profile keeps the boot cache** (`/tmp/autokw-shots-profile-<port>`,
  keyed by the build number): after changing what a building looks like
  without bumping the build, delete that folder or you shoot the cached city.
- **Farmland:** surface.png blue outside the green = crop code / 30
  (build_wood.py), `geo.farmAt`, `world.groundTint`.
- **Water:** only vertices with > 25 % of their 50 m wet are drawn and dug;
  banks are re-lifted over their water after street grading.
- **Roll Up the Rim (src/rollup.js):** every Tims in `kwData().built.tims`
  carries a `door` (kw.js buildSigns: 1.6 m out from its sign's face, or in
  front of a small store it built; null for a pylon-only store, which then
  answers within 14 m of its point). ENTER on foot within 5 m of a door, or
  ENTER in a stopped road vehicle within 45 m (the drive-thru, via
  `game.tryDriveThru` in player.js before exitVehicle), holds the world
  (`'rollup'`) and opens a DOM overlay: medium $2 / 1 roll, large $3 / 2,
  double-double toggle. The cup is a canvas: the wrap is mapped round the cone
  in 90 slices so the cup turns (English front, French back, each side
  unrolls on its own); upward drags on the stage roll the lip (`_need()` px
  per side, ~3 swipes), Up / W / Space held rolls by keyboard. The prize is
  drawn when the cup is poured (`PRIZES`, 21 % win, car 1 in 400); the car is
  `traffic.spawnAt(..., 'apron')` at the kerb nearest the door on the store's
  side. Stats in localStorage `autokw-rollup`. After a drive-thru the next
  ENTER at the same store gets you out (`dtLock`). Harness hooks:
  `__dbg.rollup.rig = 'car' | 'c100' | 'lose' | ...` forces the next cup,
  `__dbg.rollup._roll(dp)` rolls. Shots: `docs/rollup-*.png`.
- **Golf** (src/golf.js, `data/golf.json` from tools/kw/build_golf.py):
  Rockway, Westmount, Grey Silo (18), Conestoga (27: The Village, The Moors,
  Goose Run -- OSM's hole `name` is the nine; holes are keyed nine + ref,
  labelled "THE MOORS 4", bests keyed `nine:ref`, a map marker per nine) and
  Doon Valley's front nine (by way id in `PLAYED`: OSM numbers a par-3 course
  1-9 inside the same boundary), each hole from OSM (golf=hole ref/par/line,
  tee/green/fairway/bunker/water polygons; every feature goes to the hole
  whose line is nearest). Rounds are three holes: ENTER on tee 1, 4, 7, ...
  plays the next three; bests in `autokw-golf-<course>` keyed by first hole.
  Surfaces are OSM's polygons earcut and **clipped along the terrain mesh's
  own 40 m cells and tx + tz = 1 diagonals**, so each piece is a plane on the
  ground (one mesh per course, ~16-19k tris); layers sit at `LIFT` over the
  terrain and the ball rests at the same lift. `golf.keepClear` is in
  `city.extraClear` (no trees on or within 3 m of a mown surface). Water the
  world already draws is not drawn again; water is a stroke and a drop,
  past the boundary / a road / a building a stroke and the shot again.
  **Every outer ring of a course's multipolygon is the course** (Grey Silo's
  1st and 18th are a separate piece across the creek: holes, features and
  `more` rings in play). A ball at rest against a trunk is not knocked back
  by it on the next swing (no trunk test in the first 1.5 m of flight, and
  only while moving into it).
  **Nine more: Dundee Country Club, Whistle Bear, Grand Valley, Deer
  Ridge, Beaverdale, Rebel Creek, Galt Country Club, Savannah Golf Links (18
  each) and Ariss Valley (9)**, the same path: `PLAYED` in build_golf.py.
  New options there: `refs` {way id: hole} for a hole OSM numbers wrong
  (Galt's 8th is ref=9 name="Hole 8"), `pars` {hole: par} for one OSM gives
  no par (Savannah's 15th, a 4 on the club's card -- GolfPass's card matches
  all 18), `short` (the HUD/map name: "Dundee", "Galt"). **An unnamed
  boundary is `#<way id>`** (Galt CC is OSM 138183591, no name; 750
  Coronation Blvd). A hole whose line ends near no green of its own borrows
  the nearest green within 60 m (Savannah's 7th and 9th share one). The
  build asserts every course lies inside the map. `tools/kw/build_golf.py`'s
  report prints every candidate's mapping. **Skipped:** Elmira (z -17.5 km),
  Cambridge Golf Club (x 18.5 km), Puslinch Lake, Foxwood (27 holes, nines
  unnamed) and Cutten Fields are past the map's edge; RiverEdge (Doon's
  par-3 boundary, 4 holes mapped), Merry Hill (OSM 39872940, unnamed, no
  holes) and Bridgewater have no hole data; the red/gold nines OSM maps east
  of Beaverdale (ways 1488001084..1488007311) have no boundary, refs like
  "red 6" and most pars missing; Westmount and Rockway were already in.
  **A green is played near level** (`GREEN_TILT` 0.03: the slope a ball
  feels on a green or fringe, after the course-wide 0.4): the 40 m DEM puts
  greens on 20-31 % (Deer Ridge's 1st, Galt, Savannah, Conestoga 18 %),
  where 0.4 x g x slope beat the green's 0.62 m/s2 roll and no putt stopped
  (golfcheck: Deer Ridge's 1st 12 strokes, 7 putts, before; 7 after).
  **Courses are range-culled** (golf.js `range`, from main.js draw, as the
  flags): a course's mesh draws only within `GOLF_RANGE` 2500 m of its
  bounding sphere (or while it is being played). rangeab (`__abOld` =
  `golf.rangeR = 1e9`), pixels changed / draws culled -> all drawn: spawn 0,
  175 -> 177; air-uptown 20 (A/A 16); air-galt 50, 144 -> 145; air-region
  814 of 737k, 218 -> 221; Westmount from the street 0, 141 -> 143.
  Verify: `node tools/kw/golfcheck.mjs <dir> [rockway,westmount,conestoga,greysilo,doon,dundee,whistlebear,grandvalley,deerridge,beaverdale,rebelcreek,ariss,galt,savannah]`
  plays a round per course through ENTER and the SWING button (`GOLF_WATER=1`
  adds the penalties; a shot that comes back is re-played shorter and to one
  side, as a player would). Phone cost: each course is one mesh (Whistle
  Bear ~30k tris -- 117 bunkers -- Conestoga, Grey Silo, Deer Ridge ~23k,
  Beaverdale / Ariss / Doon ~10k; 249k for all fourteen), +1-3 draws where
  it is in view. Shots: docs/golf-<course>.jpg. golf.json is 645 KB (was
  235).
- **Horse and buggy** (src/buggy.js; `buggy` in vehicles.js TYPES, hooked in
  with four lines: HAND_BUILT, the constructor's `this.buggy`, `sync()`, and
  no tyre model / generic contact shadow). The CART is the vehicle's own
  paint/trim/matte (driver in `matte.crew`), turned about the front axle's
  kingpin every sync like a trailer (`CART.kz`, rear axle dragged after it).
  The HORSE, harness, shafts, front axle and all four wheels are ONE
  SkinnedMesh (22 bones, `v.extra`, so traffic's far LOD never replaces it);
  legs are two-bone IK on hooves (walk < 8.3 km/h < trot < 20 < canter, with
  hysteresis, cross-faded), the trunk dips where a planted leg needs it. The
  gait phase advances by DISTANCE moved, blends by wall-clock dt (sync runs
  more than once a frame). Parked at the St. Jacobs market's horse shed and
  four farmyards (`BUGGY_SPOTS`); `Buggies` drives 3-5 ('path' mode, like the
  cyclists) on two-way country roads in `rural()`, on the right shoulder at
  ~12 km/h, easing behind anything ahead. Sounds: `hoof`, `hoof_soft`,
  `snort`, `whinny` in audio.js SOUNDS (played from buggy.js per footfall;
  the horn whinnies). Verify the model with `node tools/kw/buggyshots.mjs
  <dir> [views]` (a plain stage, seconds; prints fetlock contact per gait and
  the sounds' levels). Phone cost: 5 draws and ~9k triangles a buggy in view.
- **The harvest: src/crops.js** (docs/combine.jpg, harvest.jpg, tractor.jpg).
  `world.cropAt` says what STANDS (1 corn, 2 soy): OSM's farmland crop, else
  the open country's township parcels -- it must agree with `groundTint`,
  which paints the same fields. Crops are PLANT CELLS on the township grid
  (rows along w = 0.6x + 0.8z, 1.52 m apart, cells 2 m along a row), in
  tiles of 16 x 12 cells built a few a frame round the CAMERA (`stream`,
  called from draw(), so paused harness views get them too). Drawn as two
  InstancedMeshes, one alpha-tested material over a canvas atlas (corn left
  half, soy right, `aSoy` per instance; normals tipped up so both faces of a
  card light alike): within NEAR (56 m phone / 80 desktop) three crossed
  cards a cell (12 tris); out to FAR (150 / 210) one textured 6 m block per
  4 x 3 cells. No shadow casting. Phone, in a corn field: +2 draws, +29-37k
  tris (desktop +35-72k). **The cut record** is a Set of cell keys kept in
  sessionStorage `autokw-crops`: the combine's header (`COMBINE_HEADER`)
  cuts what it passes over into the tank (300 bu, corn $5.20, soy $13.40),
  any other vehicle you drive flattens its own width. Stop the combine
  within 40 m of a farm's spot (or on an OSM farmyard) to sell. The reel
  (`spinPart` axis 'x') and the grain heap (axis 'g', narrow and buried in
  the body until there is grain) are live parts crops.js moves.
  **The machines** are `tractor` and `combine` in vehicles.js (`ag`: lugged
  `agWheel`s, each wheel spun by its own radius; the combine `rws`: rear
  wheels steer against the turn and the body swings out round the drive
  axle). `Crops.spawnFarms` parks them at boot by a spiral search round
  `FARMS` (real places; ~15 ms) using tools/kw/proj.py's projection --
  **geo.toWorld still carries Seattle's LAT0/LON0**, so don't use it here.
- **The places: src/kwplaces.js** (kw.json `places` from build_kw.py
  `build_places`; docs/landmark-*.jpg): Uptown Waterloo, Waterloo Park, RIM
  Park, Conestoga Mall. `prepPlaces` (before meshing) gives every footprint
  it draws `kw.skip` + h 0; `buildPlaces` is one landmarks.js extra.
  **Uptown:** every low building with a wall on King St between William and
  Bridgeport (`places.king`: OSM footprint, levels, the shops OSM maps
  inside it) is a heritage block -- brick in nine tones, a storefront per
  shop on each street face (bulkhead, glass, recessed door, sign band with
  the real name, ~60 % awnings, blade signs on pubs/restaurants), upper
  windows with sills and arched lintels, string courses, a bracketed
  cornice; party walls (inside a neighbour) get nothing. The Old Post Office
  (35 King N) has its clock tower on the King/Dupont corner (`postOfficeTower`).
  Double-globe lamp posts with UPTOWN WATERLOO banners every 30 m and street
  trees in grates half way between them (`kingLamps`, `STATS.kingTrees`).
  **Waterloo Public Square** (docs/uptown-*.jpg; sources: the City's site
  plan PDF, July 2026, and the 2012/2019/2024 Commons and Flickr photos):
  King St is its EAST side, Willis Way its SOUTH, ION and the one-platform
  station (northbound only) its NORTH, the mall its WEST. There was no
  2023 rebuild -- the 2009 square plus the five leaf shades (2023) and the
  water feature. Drawn from OSM: the courtyard (`COURT`, pedestrian area
  760863913) paved in light slabs and a 6.2 m grid of dark bands; the rink
  (`RINK`, at OSM 202051421's place and extent but a SYMMETRIC rounded rectangle, 31.4 x 19.8 m with 5 m corners -- OSM's outline is lopsided; the sheet is a fan from its middle, levelled on the courtyard's highest point under it so the paving can't show through) as the City's: a white sheet in a LOW white curb with
  a red stripe, a gap toward King -- "not designed for hockey", so no boards
  or nets (the ice is two platforms); the stage and two seat-steps along
  the courtyard's curved edge (`AMPHI`, `TIERS`) up to the terrace at
  `TERRACE` 1.35 m (the mall's floor: OSM has 12 steps from the main
  entrance), the terrace itself a grid of 1.5 m platforms; the entrance
  stair (a sloped platform, rails); the water wall and four pools stepping
  north beside the stepped walk (`POOLS`, `WALK`); Beertown's patio with red
  umbrellas; the five vertical leaf shades (`leaves`: a steel spine curling
  back over the terrace, timber slats, ~8 m); the Corten Waterloo Bell on
  its plinth (`BELL`); the planted beds and the Willis Way grove; trees,
  benches, bins and the GRT shelter along King; tall grey lights with
  banners and baskets; the event trailer and the hedge by the station. The
  Shops at Waterloo Town Square: grey precast, glass, THE SHOPS / 75 KING
  over the glass-canopied entrance, SHOPPERS DRUG MART, BEERTOWN, PIPER ARMS.
  Also drawn here now: the **Marsland Centre** (the BMO tower, 52 m, maroon
  and beige fins, the BMO box sign at the top; `MARSLAND*`) and the **Uptown
  Parkade** across King (`PARKADE`: buff brick, cream arches, the blue glass
  stair tower). The Seagram Lofts (buff, shuttered windows, the penthouse
  floors, SEAGRAM / DISTILLERS on No. 3's east face). **Each King St block's
  real look is in src/kwuptown.js** (next entry). **Waterloo Park:** footbridges (`BRIDGES`, OSM ways; decks
  are `ctx.platforms`, walkable), the grist mill and wheel, the 1820 log
  school, the Eby farmhouse/Potters' Workshop, barn and EMPTY paddocks (the
  animal farm closed in 2024 -- don't put animals back), gazebos, the
  Jubilee gate, the splash pad, the diamonds. **Geese** (`Geese`, updated
  from main.js each frame, `window.__geese`): 7 flocks (park lawns, Silver
  Lake, UW), 3 InstancedMeshes (stand / graze / fly), drawn within 260 m of
  the camera; they flee someone on foot, the gander stands and honks
  (`goose` in audio.js), a car within 16 m above 7 m/s puts them in the air.
  **RIM Park:** every OSM pitch (`places.pitches`, a fan under its box is a
  diamond) drawn by `field()` with light masts; the Elam Martin farmstead
  (house, bank barn, silo); the sign at University Ave. **Conestoga Mall:**
  the 168-point plan simplified (`simplify`), entrances at OSM's entrance
  nodes, the anchors' raised parapets and signs (`MALL_ANCHORS`, 2026: the
  Bay is Urban Behavior), Galaxy Cinemas' own block, the pylon on King St.
  **Lettering is on its own canvas** (`PlaceAtlas`, 2048 x 1280; at 1024 it
  overflowed by 3 px once the square's signs came, `STATS.atlas.full`): the
  shared sign atlas is ~90 % full before these run and overflowed (blank
  signs) when they shared it. Trees keep off the buildings and pitches
  (`clearAt`). `window.__noPlaces = true` before boot turns it all off
  (kwshots `VIEW_BOOT_JS`) for a before/after; `window.__kwPlaces` has the
  triangle/solid counts. Phone (AUTO_PHONE=1, GPU), before -> after:
  Uptown street 210 -> 225 draws, 829k -> 872k tris; Waterloo Park
  191 -> 196, 710k -> 755k; RIM 118 -> 119; Conestoga 338 -> 346. The
  square's rebuild, phone at the opening frame: 191 -> 196 draws, 852k ->
  881k tris (the old King St opening frame was 253 / 927k).
- **Uptown, building by building: src/kwuptown.js** (docs/uptown-king-erb.jpg,
  uptown-huether.jpg, uptown-king-s.jpg, uptown-buildings.jpg). `LOOKS` gives
  each King St footprint (matched by centroid within 4 m, the OSM address in
  `addr`) its look, read by kwplaces.js `meshKing` through `r.look`: wall /
  trim / sill / band / quoin colours, storeys and parapet height, windows
  across the main face (`win.n`, `head` seg / round / hood / flat, `pair`),
  cornice (bracket / corbel / plain / none), a raised name panel (1890, 1930,
  CENTRAL BLOCK 1881), `ground: 'bank'` (ashlar, tall windows, `sign`) or
  `'none'`, the shops as they read (`shops` on the main face, `side`; colours,
  awnings, blade signs, `f` shares, `flip`) and an `extra(info)` for the rest.
  **Sources** (Oct 2026): the City's Heritage Register and its June 2026
  Notices of Intention to Designate (15, 16-24, 23-25 King N, 36-40 King S),
  historicwaterloo.ca / historicplaces.ca, Commons photos 2010-2026; colours are
  hex estimates read off those photos. Drawn specially: the **Huether** (OSM's
  one footprint split three ways along Princess: the 1880 corner hotel to 17 m
  -- buff brick, paired round-headed windows, the slate mansard and gabled
  dormers, rust awnings on King, the Lion Brewery disc and Café 1842's board at
  the corner, the marquee post, the fire escape on Princess -- a stucco part
  with HUETHER HOTEL down it, and the old brewery holding the **Original
  Princess Cinema**: the white portal with PRINCESS, the lightbox, BREWERY);
  the **Waterloo Hotel** (buff, 8 bays, the 1890 pavilion, navy awnings, PÜR &
  SIMPLE at the corner); the **Old Post Office** (red brick over sandstone, its
  tower at OSM's tower part, 23 m to the tip); **Princess Twin** (fieldstone
  piers, the perforated screen with PRINCESS TWIN / CINEMAS, the marquee,
  Princess Cafe); the 1936 **Waterloo Theatre** (16-24 King N, hexagonal
  lights, the cast-stone centre bay); **28 King N** (the Chainsaw until 2020,
  Revive Karaoke now); the **Conrad Block**, the **Roos Building**, the
  **Commercial Block** (2-10 King S), the **Letter Block** (TRIO), the **Duke of
  Wellington** (1930 datestone, quoins, paired windows, the green oval sign);
  the **Molsons Bank / BMO** (Ionic columns, THE MOLSONS BANK frieze). Blocks
  with no photograph found get `UNKNOWN` (buff, red, painted, stucco -- never
  the old green / purple tones). `BUILDINGS` draws Uptown's others from their
  OSM footprints with kwsights.js `block()` (now exported): **Waterloo City
  Centre** (tan brick, green glass, the drum with WATERLOO CITY CENTRE), the
  **library** (fieldstone, beige fascia, brown roof), **57 Erb St W** (the
  Seagram barrel warehouse / museum: buff, shutters), **95 King S** (red brick,
  the aluminium rotunda, STARBUCKS COFFEE, green umbrellas), **Fourteen
  Princess** (blue glass, tan bands). `bikeLanes`: King St N, Erb to
  Bridgeport, black bollards with white bands every 3.5 m and green paint
  across each side street and the queue boxes at Erb. Not found / not done:
  Morty's is at 272 King N (outside Uptown); there is no Starbucks at King &
  Erb (it is at 95 King S); no big UPTOWN gateway sign exists, and the BIA
  banner art was not found (the banners are white / teal / blue stand-ins);
  the Barrel Yards towers (Onyx, Cooperage, Staves, Bevel), Circa 1877, 45 /
  55 Caroline N stay generic -- their colours were not found. Everything is
  built inside kwplaces.js's uptown run (`addUptown`), so it adds no draws.
  `window.__kwUptown` has the counts (looks, defaults, bollards). Phone
  (AUTO_PHONE=1, GPU), before -> after: the spawn 205 -> 205 draws, 981k ->
  989k tris; King & Erb 232 -> 233, 961k -> 974k; King & William 276 -> 276;
  King & Bridgeport 355 -> 357; 0 exceptions. Verify: kwshots with views at
  the intersections (e.g. `{c: [-3828, -1438, 1.6], t: [-3858, -1585, 6]}`
  up King N from Erb) and close-ups per building.
- **Downtown Kitchener and Cambridge, building by building: src/kwdowntown.js**
  (docs/downtown2-*.jpg). The second pass on kwsights.js's v25 work, done as
  kwuptown.js did Uptown. `prepDowntown` (main.js, right after prepSights)
  gives every `sights.king` block a look (`LOOKS`, matched by centroid within
  4 m; `__kwDowntown.miss` lists any that matched nothing; per-town `UNKNOWN`
  palettes otherwise -- Galt grey limestone, Preston/Hespeler red and yellow
  brick); cuts Galt's Main St rows that OSM traces as ONE outline back into
  storefronts (`SPLITS`); takes the specially drawn blocks out of meshKing's
  run (`SPECIAL_KING`: the Farmers' Market); and sets `bd.kw.tower` on the
  towers' boxes (`TOWERS`), which world.js `modernTower` / `towerLook` /
  `buildingFamily` honour as the real cladding (c, panel, glass). Everything
  else is built inside buildSights through `addSights` (kwsights.js: same
  Kit, same atlas, now 2048 x 3072 -- it overflowed at 1536 once Preston and
  Hespeler's signs came, and again at 2048 once kwnature / ballpark's did). **Data** (tools/kw/build_sights.py): MAIN_STREETS
  gained Preston's King St E and Hespeler's Queen St (houses skipped);
  `KING_FORCE` puts the Walper (5 storeys, over the size cut), the 1931 PUC
  building, THEMUSEUM and Galt's three long rows on the main street; SIGHTS
  gained `kpl`, `gci`, `cpres`, `galthall`, `ccentre`. **Drawn:** King St's
  Walper (red-orange brick, cream bracketed cornice, THE WALPER banners, the
  W disc), the Weber Block's Ionic loggia, Knell Hardware, 73 King W, the
  2024-designated 83-109 King W row, the Simpson Block (1895), the PUC
  building, Weber Chambers (name panel), One Young (glass), 165 King W
  (ribbed metal), the Germania Block / CIBC, THEMUSEUM (the old Goudies: the
  black M panel), Scotiabank (limestone and green granite), the 1959 TD /
  Crabby Joe's fins, New City Supermarket and Hong Kong Plaza's gables;
  DTK, Charlie West, One Victoria, Young Condos, Garment St and Union Towers
  in their colours; the library's green glass front with the white name and
  pinwheel. Galt: the Galt Collegiate Institute (crow-stepped slate ranges,
  two towers with the copper caps the aerial sees, the 1963 brick wing),
  Central Presbyterian (nave, transept, 56 m spire), the 1858 Town Hall
  (clocks, open belfry, mansard cap), the Farmers' Market (buff brick, red
  quoins, hip roof, the red entrance tower, verandah). Hespeler: 18-24 Queen
  W's mansard and round dormers, the 1928 post office. **Cambridge Centre**
  from the aerial: the Bay's box painted red (closed June 2025), the south
  anchor's Mark's / Sport Chek / Marshalls, skylights, the cinema roof, doors,
  the pylon on Hespeler Rd. Sources in the file header (historicplaces.ca,
  the City of Kitchener designated/listed indexes, Commons photos). **Not
  done:** the Preston Springs Hotel was demolished in Jan 2021 (its lot at
  King & Fountain is empty; nothing is drawn); Preston's King St blocks have
  no researched looks (defaults); Market Square's green glass and clock, 55
  King W's granite tower, the 44-storey tower at King & Francis and Station
  Park's later phases are untouched; Hespeler Rd's big boxes stay kwshops'.
  `window.__noDowntown = true` before boot turns the looks/towers/specials off
  (sights.json's new blocks still draw with meshKing's defaults; the five
  new sights' boxes stay flat and undrawn, so it is a debug switch, not a
  before). Phone
  (AUTO_PHONE=1, GPU), before -> after, draws / tris: spawn 208/1046k ->
  207/1042k; King at Water 353 -> 349; King at Young 426 -> 425; King at
  Cedar 396 -> 389; Galt Main St 113/956k -> 113/963k; Central Pres 205 ->
  211; GCI 159 -> 158; Dickson St 114 -> 114; Preston King St 184/926k ->
  190/940k; Hespeler Queen St 113 -> 113; Cambridge Centre 114 -> 117; 0
  exceptions. Verify: `tools/kw/probe_blocks.py` dumps every footprint in a
  box with all its OSM tags (address, colour); kwshots views from across the
  street, e.g. `{c: [-1138.7, 238.2, 1.6], t: [-1177, 256, 10]}` (the
  Walper), `{c: [12905, 10345, 1.6], t: [12820, 10276, 14]}` (Central Pres),
  `{c: [12760, 9135, 1.6], t: [12637, 9222, 10]}` (GCI from Water St).
- **The landmarks pass: src/kwlandmarks2.js** (`data/lm2.json` from
  tools/kw/build_lm2.py; docs/lm2-*.jpg, master over this). The places a
  Kitchener kid names from the car that were still the importer's boxes,
  each from its OSM footprint (`LANDMARKS`, nearest centroid within 12 m,
  asserted): **the hospitals** (WRHN since April 2025) -- WRHN @ Midtown
  (Grand River: the red-brown brick wings, the tall brick block, the white
  front block on the drive with WRHN @ Midtown on it, MAIN ENTRANCE, the
  cancer centre on Green St), WRHN @ Queen's Blvd (St. Mary's: buff wings
  and the 1962 ten-storey slab, ~49 m), WRHN @ Chicopee (Freeport: brick
  pavilions under brown hipped roofs, the round pavilion, the glass pyramid;
  no emergency department, so none drawn), Cambridge Memorial (Stantec's 2020
  A wing in two runs bending along the Grand, masonry and full-height glass,
  the old brick tower); each emergency department has the vestibule, the red
  EMERGENCY band and fascia and the ambulance bay's lines (`emergency()`), and
  a blue H sign by the drive. **Perimeter Institute** (OSM's outline split at
  z -1466: the building north of it -- the south front's slanted black blades
  with stainless-lined mirror slots, the glass north wall with study boxes
  over Silver Lake, the Hawking Centre's lantern -- and the reflecting pool
  south of it with the entrance bridge). **The CIGI Campus** (brick to Erb and
  Caroline, the courtyard CUT OUT of the roof -- kwplaces.js `roof()` and
  kwsights.js `block()` now take `holes` -- glazed round with fir mullions,
  the water feature, the auditorium's green roof, CIGI / BALSILLIE SCHOOL
  lettering). **Sun Life** (the 1912 Mutual Life front: buff Roman brick,
  quoins, balustrade, paired columns and pediment, MUTUAL LIFE on the
  frieze, the Sun Life sign on the lawn; the later offices behind and the
  dark tower). **Manulife** (500 King N: the long pale curve, green-grey
  ribbons, the green sign on the parking face). **BlackBerry** A-D (grey
  panels, blue curtain glass, white fins, the logo on A and B). **The
  Waterloo Region Courthouse** (pale stone, zinc top floors, the glazed
  atrium and entrance on Frederick St, bilingual name), **150 Frederick**
  (brick slab, the round council chamber under its copper cone), **Kitchener
  station** (red brick, arched windows, hipped slate roof on brackets,
  KITCHENER boards, VIA / GO, the platform canopy) and the 1925 freight shed
  (GODERICH-EXETER RAILWAY). **Sources** (file header): the Esri aerial for
  every plan -- the towers are oriented boxes read off it, OSM maps no parts
  here; OSM levels (St. Mary's 10, courthouse 7, 150 Frederick 8, BlackBerry
  4-5); Canadian Architect / perimeterinstitute.ca / tboake.com, KPMB /
  Doors Open (CIGI), NORR / Infrastructure Ontario (courthouse), Stantec 2020
  (CMH), smgh.ca / CBC (St. Mary's tower), historicplaces.ca 11829 (Mutual
  Life), historicplaces.ca 4571 (the station). **Estimated:** every colour;
  every tower height but St. Mary's; which face each EMERGENCY is on (toward
  the ambulance drive the aerial shows); Sun Life's and Manulife's heights;
  the WRHN wordmarks (lettering, not the logo). **Draws: none of its own.**
  kwsights' Kit would put pieces in plain clusters these cells did not have
  (+3 draws each at GRH, Freeport, CMH, BlackBerry); instead `LmKit` puts
  every shell into buildPolys' `kwp` cluster in kw.js's footprint material
  (as uwcampus.js does; a builder retires at 50k vertices) and every letter
  into kw.js buildSigns' `kw` cluster on the SHARED sign atlas -- it is a
  landmarks.js extra of its own (`addLandmarkExtra(buildLandmarks2)`), so
  `ctx.atlas` is that atlas (1344 -> 1664 rows of 2048 used). **Tims inside
  them:** kw.js `addSignHost(pts)` -- a Tims point in (or within 12 m of) a
  host footprint signs on its real wall (GRH, St. Mary's, Freeport, CMH, the
  courthouse, Sun Life); before it, storeSign found only the flattened box
  and built a little Tims store in the middle of the hospital. **The sights
  atlas was overflowing on master** (`__kwSights.atlas` y 2206 of 2048, full
  23: the last rows of kwnature / ballpark lettering blank); it is 2048 x 3072
  now (cropAtlas trims it to the 2206 used). `window.__noLm2 = true` before
  boot turns the pass off; `window.__kwLm2` has the built list, errors,
  triangles (~38k), the atlas row it ended on and the EMERGENCY doors (`er`).
  Phone (AUTO_PHONE=1, GPU, tools/kw/seedrandom.js), master -> this, draws:
  spawn 178 -> 174; from the street GRH 175 -> 171, St. Mary's 240 -> 237,
  Freeport 196 -> 193, CMH 119 -> 115, Perimeter 235 -> 232, CIGI 309 -> 307,
  Sun Life 198 -> 194, Manulife 145 -> 141, BlackBerry 343 -> 336, courthouse
  250 -> 246, 150 Frederick 354 -> 355, station 332 -> 334; from the air
  130 -> 128 (GRH) ... 163 -> 158 (Perimeter), all within +3 (unseeded runs
  wander +-3); tris within +-1.5 %. trafficbench (rail off, phone) hashes =
  master at all six sites; poleprobe identical; funprobe ALL OK (63); 0
  exceptions. **Not done** (KCI, Cambridge City Hall, the Hespeler library,
  the Inn, the Delta and Laurel Dam since drawn: round three, below): St. Jerome's / St. Paul's (uwcampus.js draws
  St. Jerome's; St. Paul's is not named in OSM), Sportsworld Crossing (its
  stores are kwshops'), KCI, Cambridge City Hall (2008, behind Galt Town
  Hall), the Queen's Square and Hespeler libraries, the Crowne Plaza and the
  Delta (their looks not found), the Inn of Waterloo, Laurel Creek's dam (OSM
  maps it; nothing drawn yet), the RIM buildings on Phillip St (now UW's);
  GRH's emergency entrance face and every interior are guesses; Sun Life's
  tower and the GRH blocks are boxes, not their real stepped massing.
  Verify: kwshots views from the street and the air, e.g. the GRH emergency
  doors `{c: [-3158, -482, 2], t: [-3122, -462, 6]}`, St. Mary's
  `{c: [-2138, 1630, 1.8], t: [-2135, 1570, 18]}`, CIGI from the air
  `{c: [-4205, -1345, 40], t: [-4118, -1272, 4]}`.
- **The landmarks pass, round three** (same module, same LmKit, same
  `data/lm2.json`: `build_lm2.py` gained `kci`, `cch`, `inn`, `delta`,
  `hesp`; docs/lm3-*.jpg, master over this, phone shots). **KCI** (787 King
  St W; OSM's footprint is unnamed, building=school): the 1924 front on the
  west half of the King frontage -- buff stone, tall three-storey glass
  between pilasters, the attic band with the school's name, the low copper
  hipped roof gone green -- the red brick classroom blocks behind, the
  four-storey east wing with its blank brick end on King, the 1903-04 wing's
  hipped roof in the middle. The brief's "cupola/tower front" is not what the
  King St photograph shows (Commons "Kci bldg.JPG"): no cupola is drawn.
  **Cambridge City Hall** (Diamond Schmitt 2008, behind the 1858 Galt Town
  Hall): four storeys, a rough-faced grey stone base with fritted glass,
  silver aluminium and ribbon glazing above, the south front's horizontal
  sunshades on posts a metre out, the main entrance under its overhang on
  the square, the framed glass bay standing out of the north elevation, the
  atrium skylight and the glazed strip the aerial shows, the green roof on
  the southern wing. **Laurel Dam** (GRCA 1968; OSM way 1284678747,
  waterway=dam, material=soil, height 5.6): see below. **The Inn of
  Waterloo** (475 King St N, the old Waterloo Inn): two-storey brick wings
  round a glass-roofed court, the four-storey block on the east side, the
  lobby doors on the drive, the name on the block. **Delta Waterloo** (110
  Erb St W, 2014, nine storeys): a pale precast frame round dark glass, a
  dark glazed ground floor, the entrance canopy and a DELTA HOTELS wordmark
  on Erb. **Idea Exchange Hespeler** (5 Tannery St E, Kongats 2006): the
  two-storey glass box wrapped round the 1923 Carnegie library, its
  ceramic frit drawn as white bands that thicken and thin round the walls,
  mullions every 1.5 m, the old library's roof square. **Laurel Dam:** the
  terrain is the 40 m DEM, which smooths the embankment away, and the
  reservoir's field (wlevel.png, 90.44 here) floods the crest line and runs
  ~15-25 m past it. So `laurelDam()` builds the embankment as a surface of
  its own on a 2 m grid over OSM's outline: rip-rap up from the lake bed at
  1:2, a ~4.5 m gravel crest 1.6 m over the water, the long grass slope
  behind; and on the river side, within 36 m of the outline, every vertex
  where the field is drawn at or over the ground is lifted 0.25 m over the
  water (`__kwLm2.damCover`, ~730 vertices), so no reservoir shows below the
  dam. The control structure from the aerial: the concrete intake tower out
  in the water at OSM's jog in the outline (its trash rack, the gate house
  on top), the walkway bridge to the crest, and the concrete outlet channel
  down the back of the dam (cut out of the surface; walls stepping down;
  the headwall with the two conduit mouths and its railing). The reservoir's
  own water shows in the channel as far as the field runs. **Sources:**
  OSM tags (tools/kw/probe_blocks.py; the dam's way by a scan of the .pbf),
  the Esri aerial (tools/kw/aerial.py) for every plan; Wikimedia Commons
  (KCI's King St front and its back), Wikipedia (KCI: built 1922-23, opened
  April 4, 1924); tboake.com's photographs of Cambridge City Hall as it
  opened (2008) and BD+C (four storeys, 85,000 sf, sky-lit atrium,
  vegetated roof); Canadian Architect (Awards of Excellence 2004,
  "Redressing Urbanity") and Doors Open (Hespeler); Delta's 2014 releases
  (nine storeys). **Estimated:** every colour; every height but the
  storey counts; KCI's front depth and its lettering's wording; where the
  Cambridge sunshades stop; the Inn and the Delta entirely from the aerial
  (no photograph of either was found: their materials, the Inn's colours,
  the Delta's frame and the wordmark's place are guesses); the dam's
  crest height over the water, its slopes, the tower's size and the
  channel's length (read off the aerial; its height over the river below is
  the DEM's, not 5.6 m). **Draws: none.** Every shell goes into a `kwp`
  cluster and every letter into a `kw` sign cluster those cells already
  had: the landmark root's meshes per cluster are identical to master's
  (1038; a probe counting `landmarks:<key>` meshes). Hespeler's cell has no
  sign cluster, so the library carries no lettering (it cost one draw). No
  Tims, FreshCo, storefront or kwshops store point lies in or within 25 m
  of a new footprint (their hosts are still registered with `addSignHost`).
  Sign atlas: ended at row 1425 of 2048, not full. Pass triangles 38k ->
  ~54k. Phone (AUTO_PHONE=1, GPU, tools/kw/seedrandom.js), master -> this,
  draws / tris: spawn 177/1173k -> 179/1173k; KCI from King 181 -> 182,
  front 178 -> 179, air 174 -> 175 (+2-4k); Cambridge from the square 252 ->
  252, north 126 -> 126, air 214 -> 214; the dam tower 195 -> 194, crest
  318 -> 316, outlet 98 -> 99, air 98 -> 99 (+0-4k); the Inn street 147 ->
  147, air 144 -> 144 (+6k); the Delta street 253 -> 253, air 202 -> 202
  (+7k); Hespeler 130 -> 130, 172 -> 172, 140 -> 140 (+3k). Seeded master
  runs wander by up to 8 at the dam's crest view (310 / 318). trafficbench
  (rail off, phone) hashes = master at all six sites; poleprobe identical
  (0 in a lane); funprobe ALL OK (63); 0 exceptions. **Not done:** the
  Crowne Plaza (105 King St E; built 1970, nine floors per one listing:
  no photograph found, and the aerial does not show which part of OSM's
  block is its tower); the Queen's Square library (Idea Exchange, 1 North
  Square); St. Jerome's / St. Paul's (uwcampus.js already draws St. Jerome's;
  St. Paul's is not named in OSM), Sportsworld Crossing (kwshops), GCI
  (kwdowntown), the Kitchener Public Library (kwdowntown). The embankment is
  drawn, not solid: you walk and drive through it at the DEM's height; the
  Carnegie library inside Hespeler's glass is not seen (the glass is
  opaque). Verify: kwshots views, e.g. KCI `{c: [-2733, -482, 1.7], t:
  [-2752, -444, 9]}`, Cambridge from the square `{c: [13178, 10224, 1.7], t:
  [13172, 10188, 10]}`, the dam's crest `{c: [-7803, -3600, 5.2], t: [-7775,
  -3540, 3.5]}`, Hespeler `{c: [13362, 2318, 1.7], t: [13378, 2340, 4]}`.
- **The landmarks pass, round four** (same module, LmKit and lm2.json:
  `build_lm2.py` gained `mktsq`, `skywalk`, `crowne`, `stmaryrc`, `stpeter`,
  `gaol`, `govhouse`, `claygl`, `wmrc`, `galtarena`; docs/lm4-*.jpg, master
  over this, phone shots). **Survey** (in game, kwshots from the air, every
  candidate the brief named): already drawn by kwsights / kwdowntown /
  kwuptown / kwplaces / round one-three -- the Kitchener Public Library,
  THEMUSEUM, the Market, Centre in the Square, the Tannery, the Breithaupt
  Block, 150 Frederick, the courthouse, Sun Life, Manulife, the Seagram
  lofts and museum, RIM Park, the Boardwalk, Bingemans, GCI, the Cambridge
  Mill, the Old Post Office. Still the importer's plain boxes (or kw.js's
  generic steeple church): Market Square, the Crowne Plaza, St. Mary's, St.
  Peter's Lutheran, the Waterloo County Gaol and Governor's House, the Clay
  and Glass Gallery, the Waterloo Memorial Rec Complex, Galt Arena Gardens,
  Idea Exchange Queen's Square, Waterloo Collegiate, Catalyst137, the WRPS
  headquarters, Langdon Hall, the Grand River Rec Complex, the Breithaupt
  Centre, Zion United, St. John the Evangelist, St. Paul's Lutheran, the
  Charles St terminal (closed 2019). The first eight are built. **Drawn:**
  **Market Square** (King & Frederick): the green-framed glass rotunda
  swallowing the outline's rounded corner (`MS_DRUM`) with GoodLife FITNESS
  round its top, the glass porch and MARKET SQUARE over the doors, the
  square clock tower of green glass in a steel frame with four clocks under
  a glass pyramid (`MS_CLOCK`), the King St front's green-mullioned glass
  and green awnings, and **the skywalk** over King to the hotel at the
  second floor (OSM's building=bridge was one of kwsights' `king` blocks,
  drawn ON the road by meshKing: prepLandmarks2 takes it out of
  `sights.king`). **The Crowne Plaza** (105 King E, the Delta until 2014):
  the King St slab -- stucco piers and bands framing recessed brown-brick
  bays, windows in pairs, five storeys over a red-brick ground floor with
  navy awnings and the doors under a canopy -- the square corner tower at
  Frederick under a grey-green hip with CROWNE PLAZA and the crown on two
  faces, the small capped tower at the far end, the low block behind.
  **St. Mary's** (56 Duke W, 1903): red brick Neo-Gothic laid out in the
  nave's own frame (`SM_U`, the outline's 30 deg): slate nave with
  buttresses and lancets, the front on Young St with the tall north tower
  (36 m, paired belfry lancets, four pinnacles), the 22 m south tower, the
  gable between with the rose window over three pointed doors, the north
  porch's cross gable, the sacristy and the rectory (OSM draws it in the
  church's outline). **St. Peter's Lutheran** (49 Queen N, 1966-68): the
  brown-brick nave (pitched roof off the aerial) with full-height slit
  windows over the low brick wings, the glazed Queen St front between
  concrete fins, the open bell tower (two concrete piers, bands, louvres,
  the cross). **The Waterloo County Gaol** (1853): OSM's two-storey stone
  part, rubble stone, small barred windows, a hipped slate roof; its yard
  (the outline's one-level part) walled in stone, solid; **the Governor's
  House** (1878): buff brick Italianate, cream trim, hipped roof, the front
  tower under a bell-cast cap with cresting, the verandah and balcony on
  Queen St. **The Canadian Clay and Glass Gallery** (Patkau 1993): dark red
  brick, high clerestory windows, the long dark timber canopy on squat
  concrete piers down the Caroline St side (`CG_CANOPY`: the outline is cut
  back to its inner edge; the aerial's brown strip), the doors at its north
  end, CANADIAN / CLAY & GLASS / GALLERY on the north end, the concrete
  turret by the west wall. **The Waterloo Memorial Recreation Complex**
  (101 Father David Bauer Dr; OSM's outline is unnamed): the arena under a
  long white barrel roof with ribs and a glass band (`WM_ARENA`, the
  outline's south rectangle, its walls 0.25 m proud of the outline's), the
  pool wing's solar panels (`WM_SOLAR`), the curved glass entrance drum
  between the wings (`WM_DOOR`), WATERLOO MEMORIAL RECREATION COMPLEX over
  it. **Galt Arena Gardens** (1922): brick on a high limestone base, stone
  piers, the maroon arched roof along its length, the Shade St front as the
  arch's gable end with the curved parapet and the stone-capped corner
  piers, tall windows, the canopy with GALT ARENA GARDENS on its fascia.
  Map marks and hellos for all eight. **Sources:** OSM tags
  (tools/kw/probe_blocks.py: St. Mary's and St. Peter's denominations, the
  gaol's parts and architect, the Governor's House's date and architect,
  Galt Arena's 1922); the Esri aerial (tools/kw/aerial.py, footprints
  overlaid) for every plan; Wikimedia Commons: "Kitchener Ontario St Marys
  Church 2012 1", "Kitchener old gaol and house (full view)", "Canadian Clay
  and Glass Gallery - Waterloo, ON", "Clay and Glass Museum (External
  Turrent)", "Waterloo Memorial Recreation Complex (2025)" and its aerial,
  "St. Peter's Lutheran Church - Kitchener, ON", "Galt Arena Gardens
  exterior" and "(2026-06)", "Market Square Shopping Centre - Kitchener,
  ON", "MarketSquare-Frederick&KingStE-Kitchener", "2011-07-06 ... Kitchener
  (6067186668)" (the Delta, now the Crowne Plaza, up King from Frederick);
  the St. Mary's parish and the City's 1983 designation (towers, slate roof,
  rose window; 1900-03); Doors Open / the Laurier archive (St. Peter's,
  1966-68, Kruschen & Dailey); Patkau's project page (Clay and Glass); IHG's
  2014 release (the Crowne Plaza, 201 rooms). **Estimated:** every colour
  and every height (no storey counts but OSM's 2 for Market Square and the
  gaol); the Crowne Plaza's slab depth and which block behind it is the
  ballroom (nine floors per one listing is not what the photograph shows on
  King); St. Peter's nave plan and its tower's place (aerial and one
  photograph); the WMRC's wings and entrance; Clay and Glass's canopy piers
  and lettering's place; Market Square's rotunda size, the clock tower's
  place relative to the skywalk (OSM puts the bridge where the photographs
  show the tower), its lettering; St. Mary's transept is the porch OSM
  shows, the rectory's brick. **Draws: none.** Every shell into a `kwp`
  cluster, every letter into a `kw` sign cluster those cells already had:
  the landmark root's meshes per cluster with round four off / on are
  identical (1038 / 1038; `window.__noLm4 = true` before boot turns round
  four alone off -- its footprints stay the importer's boxes). Sign atlas
  ended at row 1563 of 2048 (was 1425), not full; pass triangles ~54k ->
  ~64k. No Tims, FreshCo, storefront or kwshops store in or near a new
  footprint. **Phone** (AUTO_PHONE=1, GPU, tools/kw/seedrandom.js), master
  -> this, three runs of this (draws / tris): spawn 173/1153k -> 176, 176,
  167 (1123-1164k); Market Square corner 267 -> 269, 268, 266 (+1-12k);
  from King E 350 -> 351, 353, 345; air 252 -> 254, 253, 251; St. Mary's
  332 -> 333, 335, 328, air 323 -> 324, 326, 319 (+5-24k); St. Peter's 256
  -> 258, 257, 255; the gaol air 193 -> 197, 193, 191; Clay and Glass 176
  -> 178, 178, 175, air 156 -> 158, 158, 155; WMRC 229 -> 232, 231, 229,
  air 134 -> 136, 135, 134; Galt Arena 201 -> 203, 202, 200, air 203 ->
  205, 204, 202 (tris -3..+24k): the draw count's own run-to-run wander
  (-6..+4 by run, every view together); round four off -> on in one build
  -1..+2. trafficbench (rail off, clear, phone) hashes = master at all six
  sites; jcttraffic and hwytraffic seeded output = master's; poleprobe 0
  in a lane, 0 trunks on it (one `lamp4` fewer at its sites: a light whose
  spot now meets a new solid); AUTO_GPU=1 funprobe ALL OK (63); 0
  exceptions. **Not done / approximate:** the Queen's
  Square library (no photograph of the 1 North Square building found: the
  Commons "Idea Exchange" photograph is not clearly it), Waterloo
  Collegiate (the generic school polygon is close to the buff 1950s
  building; its breeze-block entrance not drawn), Catalyst137, the WRPS
  headquarters, Langdon Hall (down its drive, unseen from the road), the
  churches past St. Mary's and St. Peter's (kw.js's steeples); the
  skywalk is not solid and not walkable; interiors; the Crowne Plaza's
  back and the WMRC's wings are the outline as boxes. Verify: kwshots
  views, e.g. Market Square's corner `{c: [-1014, 318, 1.7], t: [-990,
  307, 11]}`, the Crowne Plaza up King `{c: [-948, 357, 1.7], t: [-1005,
  335, 11]}`, St. Mary's front `{c: [-1185, 1, 1.7], t: [-1222, -19.5,
  15]}`, Galt Arena `{c: [13684, 9914, 1.7], t: [13660, 9900, 9]}`, the
  WMRC `{c: [-4628, -1420, 1.8], t: [-4632, -1375, 7]}`.
- **The landmarks pass, round five** (same module, LmKit and lm2.json:
  `build_lm2.py` gained `zion`, `stjohn`, `stpaul`, `trinity`, `woodside`,
  `breit`, `grrc`, `qslib`, `wci`, `catalyst`; docs/lm5-*.jpg, master over
  this). **Survey** of the brief's list: already drawn -- Kitchener City
  Hall (kwsights: KPMB's rotunda and Berlin Tower; its clock tower is the
  1924 hall's in Victoria Park, drawn there), the Walper and Galt's Central
  Presbyterian (kwdowntown), the Kaufman Lofts, the Lang Tannery, Schneider
  Haus and the Waterloo Region Museum (kwsights), the Huether (kwuptown), the
  Hespeler mill (kwsights' Forbes mill). Not built: Langdon Hall (down its
  drive, unseen from the road; the Commons "Langdon Hall" photographs are
  Auburn's), the WRPS headquarters (no photograph found), the Cambridge
  Sports Park (fields, no building), the Grand River Rec Complex's arena (OSM
  maps the pool hall only). **Drawn, each on its OSM footprint:** **Zion**
  (32 Weber St W, 1893; Zion United 1968-2015, OSM still says "Zion United /
  Rockway Mennonite"): buff brick on a red sandstone base, the porch gable
  with its great pointed window, the nave's gable and three lancets behind,
  the short tower under a slate pyramid at the west corner and the tall tower
  at the front's east end -- the belfry's three pointed openings a side, the
  corbelled parapet, four turrets under green copper caps; OSM's round
  Sunday-school hall behind is the outline, flat-roofed. **St. John the
  Evangelist** (23 Water St N, Anglican): red brick, slate, the nave along
  Water St with buttresses and lancets, the transept, the north-west tower's
  broach spire with its gabled louvres, the parish hall's flat brick block
  with a green-grey coping. **St. Paul's Lutheran** (137 Queen St S, Jonas
  Knechtel 1889): dark brown brick, the gable to Queen St with four lancets,
  a round window and corner pinnacles, the corbel table under the eaves, the
  tower at the street corner with paired round-headed belfry windows and the
  tall black slate spire with lucarnes and pinnacles (OSM's jog by Queen
  St). **Trinity Anglican** (12 Blair Rd, Galt; OSM: "Trinity United",
  denomination anglican): grey limestone, the south front's traceried window,
  rose and porch with the red door, the crenellated tower at the west corner
  with its blue door, the parish hall's gable alongside; built on the street
  front's ground (`towerB`), the lot falls ~5 m to the river. **Woodside** (the
  National Historic Site, Mackenzie King's boyhood home): a storey and a half
  of buff brick, the steep shingled roof, two cross gables with dark green
  bargeboards on the north-west front (the obb's face: OSM's side is short
  jogs), the verandah on green posts, chimneys, ivy on the south-west end.
  **The Breithaupt Centre**: red brick, ribbon windows, the solar rows on
  frames over the roof, the sloped glass solarium over the pool doors toward
  the lot (`edgeOf`: OSM's two collinear 7 m runs); no lettering, below. **The Grand River Recreation Complex** (MJMA with John
  D. MacLennan, 1988-91): the Lyle S. Hallman pool under a white ribbed
  barrel vault with glazed ends (`GR_POOL`, the outline's north-east wing),
  the pale entrance block with a blue canopy. **Idea Exchange Queen's
  Square** (1 North Square, Galt): the outline split into its three parts
  (`QS_WEST`, `QS_LINK`, `QS_EAST`) -- two blocks of dark purple-brown brick
  under deep buff fascias, the taller east one with the full-height glass
  corner at the south-east, the glass link with the entrance canopy and an
  IDEA EXCHANGE sign, the buff first-floor band, the eye mosaic on the south
  front. **Waterloo Collegiate** (300 Hazel St): buff brick, the wings'
  ribbons over red-brown spandrels, the taller entrance block on Hazel St
  (`frontEdge`; `__kwLm2.wciFront`) with the white breeze-block screen, the
  shallow peaked concrete canopy on two posts over the glass doors, and
  Waterloo / Collegiate / Institute / 300 beside the screen. **Catalyst137**
  (137 Glasgow St, the 1957 Uniroyal tire warehouse reclad 2017): the whole
  212 x 373 m outline, dark brown cladding with ribs over a light base, the
  clerestory band, the white roof, the glazed entrance under a canted canopy
  in the west front's notch. **Sources:** OSM (tools/kw/probe_blocks.py: names,
  addresses, denominations); the Esri aerial with the importer's footprints
  and a 10 m grid over it (`AERIAL_FP=1 tools/kw/aerial.py`, new) for every
  plan; Wikimedia Commons: "32 Weber Street West - Kitchener, ON (2025)",
  "Church of St John the Evangelist, Kitchener, ON (2023)", "St. John the
  Evangelist Anglican Church 2026 (1)", "Trinity Anglican Church - Cambridge,
  ON" (2018), "Trinity Anglican Cambridge Ontario" (2014), "Woodside
  Kitchener 2006", "BreithauptCommunityCentre-Kitchener" (2013), "Idea
  Exchange Library System - Cambridge, ON" (2025; it is the Queen's Square
  building: the aerial's two blocks and link match it), "Waterloo Collegiate
  Institute" (2009) and "... (879605)"; Community Edition's 2015 photographs
  of St. Paul's and the City's 1983 notice of intention to designate it (the
  spire, pointed arches, lancets, brickwork; 1889); Ian Hadden / the United
  Church archives (Zion: on Weber St from 1893, Zion United 1968-2015);
  architecture-excellence.org (the GRRC: MJMA, the pool drawing under its
  arch); RENX July 2017 and its rendering (Catalyst137). **Estimated:**
  every colour and height; Zion's tower positions and the porch from an
  oblique aerial; St. John's nave and transept extents; St. Paul's nave
  width (21.4 m of the 27 m outline) and the tower's place in OSM's jog;
  Trinity's hall; Woodside's gable places; the solarium's place on the
  face; the GRRC's vault rise and the entrance; the Queen's Square eye's
  place; WCI's entrance block size; Catalyst137's whole look (a 2017
  rendering). **Draws: none of its own.** The shells go into the cells'
  `kwp` clusters, the letters into their `kw` sign clusters:
  `tools/kw/lmcount.js` (seeded, phone) master vs this: 1038 / 1038 meshes,
  every cell and material identical. What it took: (1) no lettering where
  the cell has no sign cluster -- the Breithaupt Centre (SOLARIUM,
  BREITHAUPT CENTRE are in the photograph) and Catalyst137 -- as Hespeler
  in round three; hanging it in a neighbouring cell's cluster was tried and
  swelled that cluster's bounds into half of Kitchener's views, +1 each; (2)
  flattening WCI's school polygon took it out of kwshops.js prepShops' drawn
  extent and a storefront 600 m off fell out into its own `kwr:` cluster
  (+1): round five's flattened outlines set `b.kw.ext`, which prepShops
  still counts. (3) Trinity stands on its street front's ground (`towerB`):
  `tower()` puts a block on its lowest corner, ~5 m down the river bank.
  Sign atlas: rows 1563 -> 1569 of 2048. Pass triangles ~64k -> ~73k.
  **Phone** (AUTO_PHONE=1, GPU, seedrandom, the same 16-view list, master
  -> this): seeded runs of MASTER alone differ by 3 draws run to run (spawn
  178 / 175: the skinned pedestrians), and this run's skinned count was
  +3 in every view, so: spawn 175 -> 178, every view +3, St. John and
  Catalyst137 +6, Queen's Square and the WCI air view +5 (tris +12-19k).
  Counting what is visible per view (a frustum probe over the scene, both
  builds, six views) the landmark clusters differ only by: Queen's Square
  +2 (its own cell's sign cluster, and Trinity's cell's `kwp` cluster whose
  bounds Trinity widened), and +1 looking west from Weber & Frederick (WCI's
  lettering widened its cell's sign cluster); Zion, St. John, WCI and
  Catalyst137 0 landmark-cluster change (their remaining +1-3 are unnamed
  dynamic meshes -- cars). trafficbench (rail off, clear, phone): the six
  hashes = master's; jcttraffic and hwytraffic (seeded) = master's;
  poleprobe: every class identical (0 in a lane), 40 fewer boulevard trees
  (the landmarks' tree clearings); AUTO_GPU=1 funprobe ALL OK; 0 exceptions
  everywhere. Not done / approximate: interiors; Zion's round hall is the
  outline's flat-roofed drum, not its real roof; St. John's narthex arches
  (the 2026 photograph) not drawn; the GRRC's arena; WRPS, Langdon Hall.
  `window.__noLm5 = true` before boot turns round five off. Verify:
  kwshots views, e.g. Zion `{c: [-1142, -60, 1.7], t: [-1120, -95, 14]}`,
  St. John `{c: [-1552, -54, 1.7], t: [-1515, -42, 12]}`, St. Paul's
  `{c: [-1290, 400, 1.7], t: [-1248, 428, 15]}`, Trinity `{c: [12830,
  10150, 20], t: [12795, 10105, 6]}`, Queen's Square `{c: [12742, 10320,
  1.7], t: [12700, 10285, 6]}`, WCI `{c: [-4492, -2962, 1.7], t: [-4457,
  -2981, 6]}`; `VIEW_INFO_FILE=` (kwshots, new) takes the per-view probe
  from a file.
- **The big employers' signs: src/kwbiz.js** (the landmarks pass, round six;
  run by kwlandmarks2.js with its LmKit; `build_lm2.py` gained `ot1`, `ot2`,
  `equit`, `christie`, `dare`, `wbrew`, `gore`, `gore2`; docs/biz-day-1.jpg,
  biz-day-2.jpg, biz-night.jpg). Google's wordmark on the Breithaupt Block
  (kwsights) and Toyota's at TMMC (kwsights) were already there. **Signed:**
  **BlackBerry** (A, B, C: the seven-key logo and italic wordmark in
  BlackBerry blue on the white top band of each long face, toward one end --
  the buildings are now white panels with dark ribbon windows, as the 2018
  Commons photographs show, not blue curtain glass; a face looking into a
  parking structure within 50 m is skipped, `clearAhead`); **Sun Life** (the
  tower is 78 m / 18 storeys -- CTBUH -- of dark glass between pale fins, it
  was a 33 m box; the gold sun and "Sun Life" on the crown toward Uptown,
  King St and the south; the 2008/2012 photographs read "Sun Life
  Financial", the brand has been "Sun Life" since 2015); **Manulife** (the
  green three-bar mark and serif wordmark on the top band toward King St,
  the car park and the south); **OpenText** (Buildings 1 and 2 redrawn: white
  bands, blue-grey glass; "opentext" in dark lowercase on top of both, the
  grey monument on Frank Tompa Dr -- photographs on Bing images);
  **Equitable** (the beige three-storey block at Westmount and Erb, the teal
  knot and "Equitable" at the north end of the Westmount face, the two teal
  "e" banners -- Commons 2025); **Christie** (the grey plant, CHRISTIE in
  white on a dark band high on the Wellington St face, the fieldstone wall
  with brushed-steel CHRISTIE letters at the entrance -- press photographs);
  **Dare** (the red oval with the gold rim on a raised white panel over the
  north end toward Kingsway Dr and near the north end of the west face, the
  precast monument "Dare Foods Limited / 2481 Kingsway Drive"); **Waterloo
  Brewing** (OSM's unnamed industrial footprint by the taphouse node at 400
  Bingemans Centre Dr: the buff front toward the car park, the red pointed
  WATERLOO BREWING banner with wheat ears, the red COLD BEER STORE canopy --
  Commons 2017); **Gore Mutual** (the dark stone head office with GORE MUTUAL
  and the red mark on its long south-east face, the granite ground sign by
  Dundas St, the 1935 limestone building under a copper hip roof). Map marks
  and hellos for the six new ones. **Not done:** Home Hardware's HQ in St.
  Jacobs, ATS (730 Fountain St N) and Definity (111 Westmount Rd S): no sign
  or footprint cluster within ~300-650 m of any of them, so any sign there
  is a new draw or a swollen cluster; D2L / Communitech (the Tannery's
  COMMUNITECH board is kwsights'), Sandvine, Clearpath, Maplesoft, Shopify
  (no Waterloo office in OSM), The Record (moved). Toyota's signs left as
  kwsights draws them.
  **Draws: none.** Where the letters go is the whole design: on the shared
  sign atlas, in the `kw` cluster of the building's own cell, only where that
  cluster's sphere already reaches the sign (Sun Life, OpenText, Dare) or the
  cluster is the building's own (BlackBerry's campus; Manulife's -- all its
  signs are keyed to the building's cell, its King St face is across the cell
  line). Equitable's, Christie's and Waterloo Brewing's nearest sign clusters
  are 280-370 m off: a first version hung them there and swelled kw-4,-1
  248 -> 587 m, kw0,-1 176 -> 351, kw2,-2 15 -> 491, and those clusters came
  into views they were not in (+1 at the Sun Life and Equitable views). So
  those, and Gore Mutual (cell 12,8 has no sign cluster; its footprint
  cluster key 11,8 is 58 m off), are **geometry letters** (`pixSign`: the
  sign painted on a small canvas, read back, each colour's runs merged into
  rectangles, vertex-coloured quads in kw.js's footprint material of a
  cluster whose sphere already holds them; ~2.2k quads in all; blocky at a
  few metres by design). `tools/kw/lmcount.js` (phone) `__noBiz` -> this:
  1038 / 1038 meshes, every cell and material identical. Cluster spheres that
  moved (`landmarks:<key>` geometry.boundingSphere): kw-3,-6 60 -> 132 m
  (BlackBerry's own), kw-3,-4 7 -> 59 (Manulife's own), kwp2,2 439 -> 502
  (the Dare building itself: its world box became this cluster's), kwp11,8
  627 -> 651, kwp2,-2 203 -> 214; nothing else. A frustum probe
  (tools/kw/drawprobe.js, `__probeFull`, seeded, phone) over 22 views, a
  street and an air view of every site: the landmark meshes in view are
  identical with and without round six in every one; the scene's draws
  -3..+1 (traffic and walkers). trafficbench (rail off, phone): all six
  hashes = `__noBiz`'s; nightprobe ALL OK; weatherprobe ALL PASS; 0
  exceptions. Pass triangles ~73k -> 80k.
  **Lit at night:** the atlas wall signs (BlackBerry, Sun Life, Manulife,
  OpenText, Dare) are drawn between the shared atlas's new `litBegin()` /
  `litEnd()` (landmarks.js SignAtlas: whole rows of their own), and finish()
  hands that band of rows to weather.js's TOD_BASIC as `todLitV` (map v,
  after cropAtlas): after dark those rows keep their colour while every other
  sign on the atlas dims to `todBasic` -- in the same material and program
  (the uniform is in every TOD_BASIC program, out of range for every other
  material), so no draw and no new program. The monuments and the geometry
  letters are not lit. Shared sign atlas: rows 1569 -> 1688 of 2048 (the
  pass's panels start at 1156; the lit band 1158-1259), full 0.
  **Estimated:** every colour; every sign's size (scaled off photographs
  against the storeys); which end of a face a sign is at where no
  photograph shows it (Equitable's north end, Christie's wall sign, Dare's
  west-face oval, Gore's wall sign); Sun Life's crown wording; OpenText's
  monument place; every monument's lettering; the Gore Mutual and Christie
  buildings' looks; Waterloo Brewing's footprint (OSM leaves it unnamed).
  `window.__noBiz = true` before boot turns round six off (the old
  BlackBerry, Sun Life and Manulife signs and boxes come back); `window.__kwBiz`
  lists every sign `[key, x, z, nx, nz, height]`. Verify with kwshots views
  built off it, e.g. `eval` returning `{ c, t }` from `__kwBiz.signs` (a
  sign's normal times 20-200 m), or fixed: Sun Life from its south lot `{c:
  [-3258, -529, 1.6], t: [-3400, -652, 74]}`, the Christie monument `{c: [-26,
  -1348, 1.6], t: [-29, -1327, 1.2]}`, Waterloo Brewing `{c: [1754, -1985,
  1.6], t: [1821, -2008, 11]}`.
- **The chain stores: src/kwshops.js** (`data/shops.json` from
  tools/kw/extract_shops.py -> `raw_shops.json`, then tools/kw/build_shops.py;
  docs/shops-*.jpg). Every store of ~50 brands (`BRANDS` / `GAS` in
  build_shops.py: LCBO, Beer Store, Walmart, Costco, Canadian Tire, Home
  Depot, RONA, Zehrs, Sobeys, Food Basics, No Frills, Shoppers, Dollarama,
  Winners..., the restaurants, the banks, every gas brand), matched to its
  building (the OSM polygon it is, else the one holding its node, else the
  nearest shop-like one within 40 m) and its plaza (shop=mall / named
  landuse=retail). `tools/kw/kw_shops_official.json` is the official lists
  (AllThePlaces scrape of the store locators, Oct 2026; Beer Store from its
  API): it adds stores OSM lacks and, for `AUTHORITATIVE` brands (LCBO, Beer
  Store, Walmart, Costco, Home Depot, Zehrs), drops OSM stores it lacks (the
  closed Beer Store on Cedar St). **Every logo is drawn once into ONE canvas
  atlas** (`BrandAtlas`, shelf-packed, cropped; `B` holds each brand's
  drawing) **and that texture is set as kw.js's footprint material's map**
  (`polyMat`): plain surfaces carry uv (0, 0), a white block at the canvas's
  bottom left, so buildings, canopies, pylons and logos are one material and
  merge into the `kwp` clusters with kw.js buildPolys -- at most +1 draw a
  cluster. **Buildings drawn here** (`prepShops`, before meshing: kw.skip +
  `kw.shop`; the box keeps its height, so collision and roofs stay the
  city's; a big box is raised to 9.2 m, a supermarket 7.8): `bigbox`
  (split-face base, cladding, piers, accent band, reveal lines, stepped
  parapet by the brand-colour entrance portal, glass vestibules, garden
  centre with fence and half canopy, service bays, loading docks, white/grey
  roof with rooftop units, cart corrals in the lot; per-brand `ARCH`; the
  front is the face with the most car park, `frontFace`), `unit` (a
  stand-alone LCBO / Beer Store), `strip` (every strip building in a plaza:
  sidewalk arcade on brick piers under the sign fascia -- which stays 1.8 m
  out, 3.2-4.45 m up, where kw.js hangs Tims signs -- parapet towers, back
  doors; `PLAZA_PAL`). Gas stations: OSM's building=roof canopy box goes flat
  and the canopy is drawn on its footprint in the brand's bands, with pump
  islands, logos on its fascia and a price pylon at the road. Plazas with 3+
  tenants get a pylon at their best road frontage listing up to 6 tenants
  (logos, else lettering; anchors first). Map: Walmart/Costco/CT/HD/RONA/
  Best Buy (`shop`), LCBO (`lcbo`), Beer Store (`beer`) icons with a hello on
  foot, plazas (`plaza`, labelled when anchored). kw.js's zone storefronts
  skip the chains (`KW.chainNames`). `window.__noShops = true` before boot
  turns it all off (kwshots `VIEW_BOOT_JS`); `window.__kwShops` has stats and
  the atlas. `tools/kw/aerial.py out.jpg x z [half] [zoom]` fetches Esri imagery of a spot
  for checking roofs and layouts. Phone (AUTO_PHONE=1, GPU), before -> after:
  spawn 195 -> 200 draws, 881k -> 917k tris; Boardwalk lot 66 -> 69; Sunrise
  lot 172 -> 178; Fairview aerial 399 -> 409, 946k -> 1017k. ~155k tris
  across the whole map.
- **The plazas audit** (docs/shops-plazas-*.jpg; `tools/kw/plazaprobe.js`
  prints every plaza's buildings by drawer -- strip / big / unit / poly /
  PLAIN, the white box to hunt -- its painted-lot share and its stores
  drawn/listed; `tools/kw/plazaviews.js` prints storefront-facing views of
  them for kwshots `VIEWS=`). Four fixes, all data-driven:
  - **L- and U-shaped plazas are drawn from their outline**: build_kw.py
    `_swallowing_box` sends every retail/commercial footprint of 1500-40,000
    m2 that fills under 62% of its min-area rectangle to kw.js's polys (603
    -> 657). Their box was a slab over the car park they wrap (St. Jacobs
    Outlets: 180 x 102 m over the L's lawn; Laurelwood, Westmount Place,
    Westgate, Forest Glen, Ottawa Lackner...). Fairview, Conestoga and
    Cambridge Centre are over the cap (their modules draw them).
  - **Plain boxes in a plaza become plaza buildings** (prepShops): a
    brick/lowrise/industrial box of 220-16,000 m2 in a named plaza (not a
    Downtown/Village/Station one) that world.js would draw as a 9 m
    three-storey office or flats gets `kw.strip` (its storefront the face
    with the most lot, `lotFront`) and kwshops' arcade; under 6000 m2 and
    over 7.5 m it is cut to one storey, 7.2 m (Williamsburg, Victoria Street
    Plaza, Eastwood Square, Westmount Place's strips).
  - **A big box's other tenants sign its front** (`tenants` in buildShops):
    an LCBO, bank or Subway whose store matched an anchor's box (one OSM
    footprint for the Zehrs and the LCBO beside it) gets glass, a door, a
    canopy and its logo on a band out past the piers, at the free spot
    nearest where it really is (`sh.used`: the portal, the grocery glass,
    the vestibules). Pioneer Park's and Westgate's LCBOs had no sign before.
  - **The independents sign the fascias**: shops.json plazas carry `sh`
    (build_shops.py: every tenant with no brand here, outside kw.js's detail
    zones, up to 18 a plaza); buildShops letters them (88/118/148 x 22 px
    cells) on the strip arcades and the outline-drawn stores' fascias,
    round-robin across plazas, after kwhome's hooks, until the atlas is full
    (~260 of 591; the canvas is now 2816 rows). Chain logos, Tims and FreshCo
    reserve their fascia spans first (`fascia`, keyed by storefront).
  - 17 more brands with logos (small 72 px cells, `px`): Your Independent
    Grocer, Farm Boy, Longo's, T&T (grocery big boxes, ARCH), Rexall,
    Pharmasave, Dollar Tree, Bulk Barn, Pet Valu, PetSmart, Michaels, Mark's,
    Indigo, Home Hardware, The Brick, Leon's, Golf Town (656 stores, 69
    brands). Phone spawn 176/1112k -> 177/1113k draws/tris; trafficbench
    hashes unchanged; shops' tris 155k -> 142k (the slabs went).
  - Not done: Stanley Park and Frederick Mall are boxes (their OSM outline is
    the building). (Hespeler Rd and the non-plaza retail boxes: the next entry.)
- **The storefronts outside the plazas, and the lettering atlas**
  (docs/shops-fronts-*.jpg; `tools/kw/frontprobe.js` lists every front in a
  box -- Hespeler Rd, 401 to Dundas, by default -- as DRAWN or why not:
  `out` / `poly` / `shop:..` / `h..`, with its tenants and the atlases' sizes).
  - **Data**: build_shops.py `storefronts()` writes shops.json `fronts`:
    every building (raw_buildings, bt yes/retail/commercial/..., under 3
    storeys, not a motel/church/office by name) holding a store (raw_shops,
    by containing polygon else the nearest edge within 12 m) that is in no
    used plaza and outside kw.js's ZONES, plus each gas station's kiosk (the
    nearest small non-roof building within 46 m of amenity=fuel). Each:
    `[bx, bz, kind, [[name, x, z], ...] (the names with no brand here),
    who, [dx, dz]]` -- kind `s` strip, `f` fast-food / coffee pad (one
    tenant, under 900 m2), `b` bank pad, `a` lube / tire / repair, `k` gas
    kiosk, `c` dealer (shop=car); who = the pad's brand key or name, the
    kiosk's gas brand, the dealer's make (OSM brand, else name); [dx, dz]
    points at the street its tenants are addressed on (`toward()`, raw_roads
    by name with Rd/St/Dr... expanded), else the nearest street. 1068 fronts,
    1362 names. build_kw.py also sends an untagged (building=yes) L or U with
    a store in it to the polygons (`_holds_store`: 657 -> 680; 600 and 561
    Hespeler Rd, the Goodyear/Meineke row).
  - **Runtime**: prepShops marks a front's box (free, brick/lowrise/
    industrial, or a house-style box when the data says pad/kiosk/dealer;
    2.5-12.5 m; a two-storey `s` with under 20% lot in front is a main
    street's shop-with-flats and is left) as `kw.shop = { fmt: 'strip',
    plaza: -1, front, kind }` with its storefront the face toward its street
    (+0.6 x the dot with [dx, dz]) with the most car park and not backing on
    a road, and cuts it to one storey (s 7.2 if over 7.5; f 5.8, b 6.4, a
    6.2, k 4.9, c 7.6). **Only inside what the `kwp` clusters already draw**
    (each 1200 m key's extent of kw.js's polys, the boxes marked here, the gas canopies and the chain stores' buildings, +60 m, +120 for a dealer): a
    front with no cluster to merge into would add a draw, and one far off a
    cluster's edge would swell its bounding sphere into more views; those
    stay world.js's boxes (`frontsOut`, at most ~290 map-wide, mostly rural; 655 of the 1068 are drawn). Drawers
    (`frontBld`): `s` stripBld's arcade; `f` pad() -- glass across the front,
    the fascia canopy (the same 1.8 m out, 3.2-4.45 m up every logo, kw.js's
    Tims sign and the lettering hang on), the brand band wrapping the
    building (`FOOD_LOOK`: McD's charcoal and yellow, Tims' red, Harvey's,
    A&W, Wendy's...; else `chainLook` from the name's colours), side windows,
    the drive-through window and its canopy, the brand's pylon (or a
    lettered `textPylon`) at the road; `b` pad() in `BANK_LOOK` with stone
    pilasters; `k` pad() in the gas brand's canopy colours, its logo at one
    end of the fascia; `a` bay doors across the front, the office glass at
    one end, a flat sign band (`sh.sy`/`sh.so`: the lettering's height and
    offset); `c` the showroom's double-height glass, the make's portal
    (`MAKES`: Ford blue, Toyota/Honda white with red, Kia black...) with the
    make lettered on it, the dealer's name on a band over the glass, service
    bays on the far side. Brand logos on fronts come from store() as before
    (the box is a strip, so they go on the fascia).
  - **The lettering is a second atlas in the same material** (`TextAtlas`):
    every independent's name, the fronts' names, the pylons' lettered rows
    and the plazas' names are drawn ONCE each (by name and cell height,
    whatever the colours), white on black, measured to their own width, into
    a one-byte-a-pixel R8 DataTexture (2048 x ~2.3k). A lettered quad's
    vertex colour is the panel colour and its u is 2 x (letter colour index
    + 1) + the cell's u; polyMat's `map_fragment` is patched (`patch()`,
    customProgramCacheKey 'kwtext') to read the logo atlas under u 1 and the
    mask above it, mixing panel and letter colours (16 letter colours, a
    uniform; `CHAIN_COL` gives the chains with no logo here their colours,
    e.g. Chick-fil-A, Taco Bell, Pizza Hut, Mary Brown's, Goodyear, Midas,
    Mr. Lube, M&M, Sleep Country, the credit unions; else SIGN_PAL by name).
    So the lettering adds no material and no draw. The logo atlas crops to
    ~1660 rows. GPU (with mips): master's RGBA atlas 2816 rows 30.8 MB ->
    logos 17.3 MB + lettering 5.9 MB R8 (23.2 MB, -7.6 MB). **Plaza independents signed 261 ->
    462 of 591** (the rest: ~95 are indoor mall tenants with no storefront
    building -- Fairview, Cambridge Centre, Conestoga -- and ~30 whose fascia
    is full even at two-thirds size); 1285 names signed map-wide.
  - Phone (AUTO_PHONE=1, GPU), master -> this, two interleaved runs each
    (kwshots' `calls` drift +-3 run to run on master alone, every view
    together, so compare runs side by side): spawn 176/179 -> 178/179 draws,
    1110-1117k -> 1121-1125k tris; Hespeler Rd from the air 172/174 ->
    173/174, 637-645k -> 658-661k; 561 Hespeler 123/125 -> 125/126; Fairway
    173/175 -> 174/175; Victoria St plaza aerial 245/244 -> 245/246, 1272k ->
    1327k. Offline over 14,720 street cameras the landmark meshes in the
    frustum rose 139.49 -> 139.66 (one new cluster, Hanlon's Freshii row).
    kwshops' tris map-wide 142k -> 269k. trafficbench hashes unchanged;
    funprobe ALL OK.
  - Not done: indoor mall tenants have no sign (no storefront to hang it
    on); the fronts still outside every cluster stay world.js's boxes (the
    next entry pulled in Hespeler Rd's Tirecraft, Ontario Auto Market, Fix
    Auto and Car Match); the 580 Hespeler row's storefront is a guess between
    its lot and the road; OSM stores with no building (Action Auto Leasing)
    are not drawn.
- **The drive-throughs, and the pads' silhouettes** (docs/dthru-*.jpg;
  src/drivethru.js; kwshops.js `driveLane`, `padSilhouette`).
  - **Data**: `tools/kw/extract_drivethru.py` pulls every OSM
    highway=service + service=drive-through way (305) into
    `raw_drivethru.json`; build_shops.py `drive_lane()` gives a food pad
    (`f` front, tenant not drive_through=no) the lane passing closest to its
    outline (within 9 m, 15-260 m long) as front[6], its points turned so the
    building is on the driver's LEFT (mappers draw them either way, oneway or
    not). 71 of the 166 pads, 27 of the 34 Tims pads. Re-run
    extract_drivethru.py then build_shops.py (only `fronts` gains the lanes).
  - **Drawn** (in the pad's own `kwp` cluster builder, no draws): the lane
    resampled every 1.5 m; the WINDOW where it passes closest with the
    building on the left (on that face: glass, frame, sill, a bump-out
    canopy in the band colour), and the stop spot moved to the lane point
    nearest the window as drawn (clamped off a corner); yellow edge lines
    1.75 m either side (tangents across each sample, so corners close), a
    white arrow every 13 m, a stop bar at the window -- none on the
    building or a street (`city.onRoad`); the MENU BOARD ~16 m before the
    window (13/19/10 if that spot is taken) 2.7 m to the driver's left:
    posts, the board, its lit panels, a header in the band colour, a solid;
    the SPEAKER POST just past it with its little canopy; a DRIVE THRU sign
    (lettering atlas) where the lane starts. Paint is 5 cm over
    terrainHeight on short segments (the one height surface).
  - **Silhouettes** (`PAD_SIL`, over pad()'s box): Tims (current pads)
    espresso fascia band with the red line, stone wainscot, base and piers,
    a wood-brown entrance tower with a red cap and stone corners; McDonald's
    grey box, the yellow eyebrow arch standing on the parapet near the
    drive-through end, a wood-slat panel; Wendy's red sloped tower; Harvey's
    red tower (yellow cap); A&W dark tower with the orange cap; Burger King
    and Starbucks sloped towers; KFC red and white bucket stripes round the
    parapet; DQ and Popeyes mansards (`mansard()`). Helpers: `slopeBlock`
    (a block with a sloped top, from quads), `mansard`, `eyebrow`.
  - **The line** (drivethru.js): each lane within 230 m keeps a queue back
    from the window (6.4 m nose to nose) as long as the hour makes it
    (`lineFor`: a Tims 7 at 6-10 am, 4 to 2 pm, 3, 2, 1 at night;
    others 4 at lunch, 3 at supper, 1, none overnight; the phone's own
    clock, `__dbg.dthru.hour` pins it), capped by the lane's length. Every
    26 s (34 elsewhere; 5 with you in the lane) the car at the window pulls
    away along the lane and the rest creep up a car length over 4 s. Car
    identity is the cycle number, so colours and types stay with a car as
    it moves up. **They are scenery, not traffic**: `traffic.decor` (x, y,
    z, heading, type, colour) is drawn through the far LOD's InstancedMeshes
    (traffic.js `updateFarLod`, now also on desktop when there is decor;
    the cars' own far pass is `_farCars`), frustum-culled per car; the
    nearest in their detailed model and the driveways' type mix since the
    scenery-cars entry (residential streets section). Nothing touches
    `traffic.cars`, its RNG or Math.random -- trafficbench hashes are
    unchanged.
  - **You in it**: in the lane (within 2.6 m, facing its way) the cars
    behind you go, the ones ahead stay and are SOLID to your car
    (`keepOut`: OBB push-out, the speed into it taken away, a bump not a
    crash); the line serves every 5 s, so you reach the window in a minute.
  - **The window**: stopped (under 2.5 m/s) within 6 m of it, ENTER
    (main.js `tryDriveThru`, before getting out) orders: a Tims window is
    Roll Up the Rim's drive-thru (rollup.js, as before); anywhere else
    `MENU` -- McCafé medium $2, a Frosty $2, onion rings $3, a mug of root
    beer $2, a Whopper Jr. $4, fries and gravy $4, Pike Place $3, Cajun
    fries $3, a Blizzard $5 (whole dollars: the wallet is) -- charged to
    game.money, +5..18 health, a toast. The next ENTER there gets you out
    (`lock`). Slowing near a window toasts what it sells once a visit.
  - **The Hespeler leftovers**: a front past M of its own cell's cluster is
    now drawn when some cluster's extent -- its own cell's or a
    NEIGHBOUR's -- is within `NEXT_M` (150 m); a neighbour's is merged into
    via `b.kw.shop.ck` and buildShops' `key()` redirect (a 40 m grid of the
    redirected buildings, so its geometry, logos and lettering all go to
    that cluster; its road pylon is skipped). Fronts drawn map-wide 655 ->
    748 (Tirecraft Cambridge, Ontario Auto Market, Fix Auto Cambridge, Car
    Match on Hespeler Rd among them); frontprobe marks these NEXT.
  - **561 Hespeler's light squares in the sky** were kw.js meshPoly's
    rooftop units: placed between the outline's VERTEX centroid and a
    corner, which for an L or a U is out over the car park -- grey boxes
    6 m up over the lot. Each unit's corners are now tested inside the
    outline (skipped if not); kwplaces.js's one unit at the centroid of a
    big outline has the same test. `tools/kw/floatprobe.js` lists small
    pieces in the landmark clusters standing in the air with no building
    under them (noisy: plaza parapet towers and fascia signs list too;
    look for the grey 0.4 boxes).
  - Verify: `AUTO_GPU=1 node tools/kw/funprobe.mjs <dir> dthru` (lanes
    drawn, a lunch line ahead of you with nobody behind, its bumper solid,
    ordering at a window and the second ENTER out, a Tims window opening
    Roll Up the Rim, the morning Tims line). Shots of the lines while the
    game is paused (kwshots): pose them in a view's eval with
    `d.dthru.hour = 8; d.dthru.update(0.016, x, z, null)` and
    `traffic.updateFarLod(x, z, d.player)` with `traffic.camera = null`.
  - Phone (AUTO_PHONE=1, GPU), master -> this: spawn 176/179 -> 178/178
    draws, 1118-1126k -> 1129k tris; with no line (3 am) every view within
    master's run-to-run drift (+0..+2 draws: Hespeler from the air 201/203
    -> 203, 561 Hespeler's lot 174/194 -> 175/196); with the 8 am lines
    +2 by a lane over master's higher run (the Tims at -2527, -404: 238/240
    -> 242; Hespeler's Tims from the air 100/102 -> 104, from its lot
    123/125 -> 127; a McDonald's 205/207 -> 209), tris +30..60k.
    trafficbench hashes identical to master at all six sites.
  - Not done: the queued cars are far-LOD models (fine at 10 m, plain up
    close) and pass through pedestrians and other traffic; a car leaving the
    window vanishes at the lane's end and a new one appears at the back;
    pads with no OSM lane keep the side window with no lane (95 of 166);
    the lane paint crosses the lot's painted stalls (the lot is the terrain
    shader's); the McDonald's eyebrow is an arch on the parapet, not the
    curved fascia of the newest pads.
- **Tim Hortons' signs** (src/timsign.js, kw.js `timsCells` / `timsSign` /
  `timsPylon`, kwshops.js `timsBlock` and the plaza-unit panel; docs/tims-pad.jpg,
  tims-plaza.jpg: before over after; tims-night.jpg). Sources: Commons photos
  of Ontario stores 2018-2026 (Kingsville 2025, Essex 2025, Windsor 2025,
  London 2026 at night, Petrolia 2026, Guelph, Fergus' old oval pylon): the
  red script in channel letters straight on the wall, ~1 m caps, ~8 m wide on
  a pad's raised sign block (stacked stone or a pale panel in a charcoal
  frame), on a raised brown panel over a plaza unit, glowing red at night.
  - **The wordmark is drawn as paths** (timsign.js `drawTimsWord`): each
    letter a centreline swept with a broad nib, so it is the same script on
    the iPhone and in headless Chrome (no font is: 'Brush Script MT' is the
    Mac's, iOS has 'Snell Roundhand'). Hand-drawn: close to, not traced from,
    the real logotype. `TIMS_ASPECT` 3.65.
  - **Four cells for every store**, in the SHARED sign atlas (`L`) through
    `SignAtlas.litPanels` (landmarks.js): the red letters with dark returns on
    a clear ground, the pylon's red cabinet with the white script, DRIVE THRU
    on espresso, and the white script (the menu board). Every sign is a scaled
    clone of one (`cell()`), so 81 stores cost one 140-px row, not a cell per
    size. **They stay lit after dark:** litPanels puts its cells in a row of
    their own and records the rect; finish() turns it into the material's
    `todLitR` uv rect (after cropAtlas), and weather.js's TOD_BASIC block keeps
    texels inside it at full brightness while everything else on the atlas
    dims to todBasic. The atlas material has its own program key
    ('signAtlasLit'). A new lit sign elsewhere: add its cell to that ONE
    litPanels call (a second call would replace the rect).
  - **Where:** a Tims pad (kwshops 'f' front, `b.kw.shop.tims` from
    prepShops): PAD_SIL.tims's old 5.4 m brown tower is now `timsBlock`, up
    to `TIMS_TOWER.w` 9.6 m across the front, from the fascia to 2.7 m over the
    parapet, face 1.0 m out; kw.js `timsTower` gives both modules the same
    numbers and hangs the script across it (34). A plaza unit kwshops draws:
    a raised espresso panel `TIMS_UNIT` (7.4 x 1.95 m) on the fascia's top,
    flush with its face, with a red line under it, at the same `faceFor` spot
    kw.js signs (22); the fascia's independents keep clear of that span
    (fasciaUse). Footprint (poly) retail: channel letters on the fascia band;
    hospitals and other hosts (`addSignHost`): on the wall at 3.6 m; plain
    boxes: up to 8 x 1.8 m. **Pylons** (a store under 700 m2, 53): grey column,
    3.7 m red cabinet at 5.3 m with the white script both sides, a DRIVE THRU
    panel on a pad's; `KW.timsPylons`, and `timsKeepClear` (main.js
    `city.treeClear`) keeps trees 6.5 m off them -- the boulevard trees'
    crowns hid the cabinets. The **menu board** of a Tims lane gets a taller
    espresso header with the white script (added to the cell's `kw` sign
    cluster: `kwSignKey`, only when the board is in the same cell).
  - **Draws: none.** The pylons use kw.js's existing pole / trim materials
    (a `roof` column was +1 draw a cluster), the blocks and panels the pads'
    and plazas' own builders, the letters the clusters' existing sign-atlas
    material. Phone (AUTO_PHONE=1, GPU, seedrandom), master -> this, draws /
    tris: spawn 177/1170k -> 173/1158k; U & Bridge 297 -> 294; 730 King W
    173 -> 170; 109 King N 192 -> 190; 65 University E 190 -> 187; Courtland
    151 -> 148; a pylon 279 -> 276; the drive-thru 205 -> 202; St. Mary's
    204 -> 201 (tris -6..-12k); 0 exceptions. Sign atlas (`lmRoot.userData.signAtlas`):
    `__kwLm2.atlas.y` 1569 -> 1691; the atlas ends at 1938 of 2048, full 0.
  - **Approximate / not done:** the script is hand-drawn; the pylon is one
    generic design (no "Always Fresh" / oval era signs); the block's two
    claddings are by hash, not the store's real one; one wordmark per store
    (real pads often sign two faces); the plaza pylons' tenant rows still
    letter "Tim Hortons" in the text atlas; the GRH sign is behind another
    box (as before); the drive-thru's order point, window and DRIVE THRU
    lane sign are kwshops' generic ones.
- **ION, as it is** (src/link.js on `data/link.json`; docs/ion-*.jpg).
  Sources (Oct 2026): Wikipedia "Ion rapid transit" (stations, 10-minute
  weekday headway, 70 km/h corridor / 50 street / 20-25 in pedestrian
  areas, the 12 gated crossings), the Commons categories "Bombardier Flexity
  Freedom of Ion rapid transit" and "Ion rapid transit stations" (cars
  504-515, Mill, Queen, Kitchener City Hall, Fairway, UW).
  - **Data**: `tools/kw/extract_ion.py` (platforms, level-crossing nodes,
    embedded_rails streets -> `raw_ion.json`), then `build_ion.py`, which now
    writes only `sb`/`nb` (no 2 Line copies), each station's OSM `plats`
    (outline or edge line) and the line's `crossings` (gate / bell / light).
  - **The car** (`buildLRVGeometry`, `FF`): ONE 30.2 m five-section Flexity
    Freedom (A cab, suspended F1, centre C on the middle bogie, F2, B cab;
    0.5 m black articulations; four double doors a side). ION runs single
    cars -- the platforms were built for two and the second car's canopy was
    left for later -- so `cars: 1` (`cars: 2` couples them; SECTIONS are
    general). Livery: grey skirt, white body, dark window band, white band,
    ION blue roof line running down the cab corners (the swoosh), black
    windscreen cap and lamp band. Three draws a train as before: body (with
    the open doorways on per-section DOOR bones, scaled to nothing while
    shut), trim (glass, lamps), and the lettering -- one 1024 x 1024 atlas
    (`decalTexture`, 2 x 4 blocks) of which each train's texture clone is
    OFFSET to its block: column = destination ("301 to Conestoga" lit on cab
    A leading toward -s, "301 to Fairway" on cab B; a dark sign on the
    trailing cab), row = fleet number (504/507/510/514 A and B). The
    lettering draw is hidden past 260 m.
  - **Stations** (`_stationPlan`, `_buildStation`): each track's platform
    from its OSM outline -- side (and which side) or CENTRE (the other track
    just past it: e1 is half way, built once), its ends along the track --
    else the old guess (`osm: false`). 16 of the 19 are from OSM; Conestoga,
    Borden and Fairway fall back to the guess. Trains stop at `st.stop`
    (the platform's centre clamped so the car stays on the rails: both
    termini's platforms end the track). A canopy over one car's length about
    the stop: fritted blue glass (the `frit` cell, drawn unlit in the sign
    material, so its underside is never in shade) on grey round posts --
    cantilevered from the back of a side platform and rising toward the
    track, a butterfly on posts down a centre platform -- with the black
    name fascia (the station board, both edges of a centre platform); the
    station's coloured feature wall (`FEATURE`, the ion mark, the name, GRT;
    Queen's orange is real, the others are stand-ins); the ticket machine,
    two PRESTO validators, the next-train LED sign, a glass shelter with
    its bench, benches; name totems at both ends; ramps down to the ground.
    Seattle's entrance canopies and pylons are gone (`_buildEntrance` draws
    nothing; `st.ent` still anchors the map icon and boarding). You step off
    ONTO the platform (`platformSpot`). Waterloo Public Square's platform is
    OSM's, west of the square behind the mall; it ends where kwplaces.js's
    hedge begins (no overlap with the square).
  - **Track**: `tr.ST` (`_streetMask`: a carriageway within 9 m, or under the
    track, for runs of 60 m or more) is where ION runs in the street: there
    the bed is a concrete trackway with the rails flush and grooved, kerbed
    down to the road -- at LINK.lift still (0.36 sank it under the city's
    sidewalks, which stand ~0.5 m over the smoothed ground). Elsewhere
    ballast, and a black chain-link fence 3.75 m out on the corridor's outer
    sides (not at platforms, within 18 m of a crossing, on a road or water):
    the fence is the RIGHT half of the bed texture, cut out by the bed
    material's alphaTest (the ballast is the left half, `BED_U`), so it adds
    no draws; its posts are in the near chunks.
  - **Catenary** (`_buildPoles`, `_polesUpdate`): round grey poles with a
    two-tube cantilever, stay and insulators, every ~48 m (34 on curves):
    a centre pole between tracks 3-6.5 m apart (two instances, an arm each
    way), else a side pole 3 m off; never on a carriageway, on the far side
    of a side platform. ONE InstancedMesh (castShadow off), refilled with the
    poles within RANGE.near + 60 m whenever the camera moves 25 m; the arm
    length rides in the `armK` instance attribute (onBeforeCompile scales
    only x > 0.2, so the pole keeps its girth). ~610 poles, ~50-60 drawn.
    The contact wire and messenger with droppers stay in the near chunks.
  - **Crossings** (`_findCrossings`, `_buildCrossing`, `_crossingsUpdate`,
    `crossingClosed`): CROSS runs merged across both tracks; signals where
    OSM has a barrier or light on the line within 16 m (in the street only a
    ROAD crossing's own). 11 found, all gated: Northfield, Bearinger,
    Columbia, University, Seagram, Erb, Ottawa, Block Line, Courtland (x2),
    Wilson. Canada's: white mast, the red-bordered white crossbuck, two red
    lamps on a black backboard, the bell, the gate (arms and lit lamps are
    two InstancedMeshes, hidden while empty). Down from 3 s after a train is
    within ~22 s; `xing_bell` near; `blocks()` (traffic.js) stops cars at
    the arm.
  - **Service**: speed limits 70 km/h, 40 in the street, 25 through Uptown
    and downtown Kitchener (`vSlow`, within 420 m of those stations), dwell
    22 s. THE TIMETABLE (`makeTrains`): one train is run alone over each
    track (`_tripProfile`, the service's own code on a ghost) to time the
    trips (~33 min south, ~35 north; ION schedules 46 with its traffic
    signals); the trains are as many as fill the round trip with
    `LINK.turn` at each end at a `LINK.headway` of 10 min (8 now), each
    placed at its phase of the cycle. At the terminus a train changes ends
    onto the other platform (`_turnBack`) as soon as it is clear and waits
    there, doors open, for its slot: a headway after that terminus's last
    departure. Seattle's 6x far service while you wait is gone (it would
    break the headway); ENTER on a platform still calls the next train in.
    Doors: `ion_doors_open` / `ion_doors_close` (audio.js) for anyone near or
    aboard; aboard, "Next stop: X" as the doors close and "X" coming in
    (`announce`: the toast, and speechSynthesis en-CA where there is one;
    `window.__noSpeech` silences it). The readout is in km/h.
  - **Verify**: `VIEW_PROBE_FILE=tools/kw/ionprobe.js node tools/kw/kwshots.mjs
    <dir>` -- four hours of service (headways at nine stations: 10.0 min,
    min = max), every trip terminus to terminus (16 stops each way), and a
    RIDE: board at Conestoga from the platform, drive to Fairway stopping at
    all 15 platforms, step off onto Fairway's; prints PASS. Shots: kwshots
    with views on the tracks (`link.tracks[k]`, `st.plan`, `st.stop`); a
    paused harness must call `link.update(dt, { position })` at the view or
    the lazy chunks there are never built. Phone (AUTO_PHONE=1, GPU), before
    -> after: the spawn 206 -> 212 draws, 1042k -> 1053k tris; Waterloo
    Public Square 443 -> 448; Kitchener City Hall 433 -> 431; a train at
    Laurier 167 -> 170, 718k -> 776k; the corridor 525 -> 534; Columbia's
    crossing 349 -> 353; 0 exceptions.
  - Not done / approximate: the feature walls' colours (but Queen's) and
    patterns; the canopy is one design (the real ones vary a little, and
    UW's has its big name box); no wire stagger, span wires or feeder
    cables; the crossing gates have no pedestrian gates; two-car trains are
    supported but not run; the timetable is always the weekday daytime one;
    water drawn round University of Waterloo station (the wlevel field) is
    not ION's.

- **The spawn is on Waterloo Public Square** (`SPAWN_LL` in
  tools/kw/build_places.py, re-run it): on the courtyard north of the rink,
  looking south-west across it to the mall's entrance, the leaf shades and
  Beertown -- 3.7 m off OSM's drinking fountain, which the first try stood
  on. Off the street there is no kerb ahead, so main.js's red coupe falls
  back to the nearest kerb within 60 m (King's west kerb by the square,
  ~15 m away); short edges count, since crossings cut King into pieces.

- **Air traffic: src/airtraffic.js** (docs/air-takeoff.jpg, air-gate.jpg).
  No flight model: every movement is a `Track` -- waypoints with their
  corners filleted into arcs, height and speed interpolated along it --
  banked by the track's curvature, pitched by its climb. AIRLINERS
  (`airliner` in vehicles.js, a 737-class twinjet; its paint is the
  `'livery'` finish: magenta-flagged LIV vertices take the vehicle's colour,
  so one type wears every tail -- WestJet, Flair, Porter, Sunwing, Air Canada
  in plain text) fly straight in or downwind/base/final to the runway in use
  (`rwId`, 26 most sessions, 08 otherwise), touch down 380 m in, roll out,
  leave at the first exit they can make, taxi over `TaxiGraph` (OSM's
  taxiways + the runways' centrelines, Dijkstra with runway edges x25) to
  gates 1-3, turn round, are pushed back, taxi out, hold short 52 m off the
  centreline, line up and climb out of the map. Chartright's bizjet does
  the same to Apron VII; a WWFC Cessna flies touch-and-goes on 14/32 for
  ever; another crosses the region; a news helicopter orbits Uptown,
  downtown, the Aud, the 401... **The gates' stands 1-3 and 1A-3A are the
  airliners'** (`air.reserved`, main.js's parked fleet skips them). The
  player: a taxiing aircraft stops for you (nose 7 m short), a departure
  holds short while you are on the runway, an arrival inside 1.7 km goes
  around, the Cessna makes a low pass. None of them is in traffic.cars
  (nothing collides with them). Phone: 1 airliner, the circuit and the
  helicopter (no bizjet, no cross-country). Cost measured at the terminal
  with 4 aircraft in view: +12 draws, +15k tris (phone and desktop alike);
  live props/rotors/gear only inside 320 m (192 on a phone), shadows only
  on the ground and near. Tower chatter is a toast within 3.2 km of the
  field. Harness: `__dbg.air` (`advance(secs, player, camera)`, `state(c)`,
  `stats`, `log`, `spawnArrival`, `runwayBusy`); a fixed `kwshots` view can
  take `eval` returning `{ c, t }` (`VIEW_PRE_FILE` too).
- **YKF's control tower and FINAL APPROACH** (docs/air-tower.jpg,
  air-atc.jpg): `ykf.prepTower` flattens the stepped OSM footprint beside
  New Germany Lane by the Airport Operations Centre (OSM does not tag it;
  NAV CANADA's 2017 tower is "more central" than the 1969 one, and this
  building has its own car park) and `buildTower` draws it (19.4 m to the
  roof, a 26 m mast); the door faces the lane (`ykf.tower`). atc.js /
  atcgame.js are Seattle's game re-themed: YKF's runways to scale on their
  true bearings (jets land 26, props 32, floatplanes on the Grand). Pays $3
  an aircraft (+$50 a new best).

- **Erbsville Kartway** (src/kartway.js, src/kart.js, `data/kart.json` from
  tools/kw/build_kart.py; docs/kart-*.jpg). OSM's `highway=raceway` centreline
  (CanVec's, ~970 m) is a FIGURE EIGHT: the `bridge=yes` way closes the loop
  over the lower track. Chaikin x2, resampled every metre; `E[i]` is the
  bridge's height profile (3.6 m deck, 7 m flat each side of the crossing,
  40 m smoothstep ramps). **The surface is a `city.movers` entry
  (`deckAt`, the nearest-layer rule)**: terrain + `LIFT` (0.08: over the
  0.05 the grass test uses, so the asphalt is paved and the grass drags) + E;
  the kerbs and the paddock apron too. Under the bridge the lower layer wins
  for a kart at ground level. Parapets/abutments are landmark solids whose
  height bands miss the other layer (`y0 - 2.5` rule: keep the deck > 3 m).
  Tyre walls: offset to the outside of each turn (`zone`), pulled in to
  half way where another part of the track is close, left out where they
  fold into their own turn, on the ramps and by the paddock; ~30 tris a
  stack. The property is lawn and clear of trees and crops:
  `kartway.keepClear` is in `city.extraClear` and is `world.keepGrass`
  (world.js groundTint / cropAt: the township fields used to plant corn on
  the track). The clubhouse is OSM's small building by the parking (its box
  goes flat, drawn here with the sign); buildings the track crosses go flat.
  Phone cost at the track: 3 draws (asphalt, structures, fence) + the
  start lights (1, within 260 m), ~54k tris (tyres ~37k); a kart is 3 draws
  and ~4.8k tris, +1 for its driver. **The race (KartRace):** ENTER on foot
  within 5 m of the counter (`clubFront`) holds the world (`'kart'`, in
  reapHolds' `live`) and opens the panel: RACE (3 laps, 5 AI, the player
  5th on a 2 x 3 grid), PRACTICE (a rental kart, laps timed), LEAVE. Lights
  one a second, out together at a random 5.4-6.3 s. AI (`_decide`): pure
  pursuit of the racing line (the centreline relaxed toward least curvature,
  `O`) at `V` (speed profile: aLat 21, brake 9, drive 3.6) x pace, pulling
  out to the side with room to pass, with mistakes (run wide / lift) by
  `temper`. Progress is projected per layer (`project` with y); a lap is
  `prog` past each multiple of L. **A cut**: off the asphalt, then back on
  more than 1.3 x the distance driven + 12 m further round = +2-10 s and the
  lap is not a clean lap. Purse 250/150/100/60/40/25 by place (with
  penalties); best clean lap, races and wins in localStorage
  `autokw-kart-best`. `kart` in vehicles.js is hooked in by five small
  edits (import, TYPES, RIDERS, HAND_BUILT, the rider's visibility); its
  sound is audio.js ENGINES `kart` (one gear on a centrifugal clutch); the
  helmet is `matte.crew` round the posed rider's head. Harness:
  `__dbg.kart.autopilot = true` (+ `autoPace`) drives the player's kart
  through `player.autoDrive`; a full race through the panel's buttons
  takes ~3 min of wall clock with AUTO_GPU=1.

- **Driving dynamics: YOUR road car** (vehicles.js; docs/drive-gravel.jpg,
  drive-grass-slide.jpg). Everything here is gated on `rc` =
  `detailedWheels && spec.roadCar` (deriveSpec: four wheels and a driver --
  not a bike, quad, kart, buggy, tank, tractor/combine, aircraft or boat),
  so **traffic, police, suspects and every AI driver keep the old model**
  (STEER_BITE lock, aiSteer/aiPedals unchanged); only player.enterVehicle
  sets detailedWheels on a road car. The parts:
  - **Grip** `PLAYER_GRIP` 3.0 x latA on the tyres, the full lock asking
    `PLAYER_ASK` 1.0 of it (steerLock), `FRONT_ROAD` 0.9: at the limit the
    front lets go first (understeer: the squeal, the push, speed scrubbed),
    lifting mid-bend tucks the nose in ~20 % and is caught, it does not spin.
    It was a 4.5x tyre under a 3.7x lock: a sedan sat on rails at 3.2 g and
    never reached its limit. Now ~2.3 g -- the police's own (2.75 x latA lock).
    `tyreRoad`: past ~17 deg of slip a sliding tyre falls to ~57 % of its peak,
    so a handbrake turn keeps some way on. Heavies (len > 7: bus, trucks) have
    no tyre model; their lock is `PLAYER_GRIP_HEAVY` 2.0 (a bus ~1.2 g).
  - **Turning circle** from the wheelbase: `MAX_STEER` 0.62 rad (0.58 heavy)
    replaces one 4.5 m floor for every car: a city car 9.9 m kerb to kerb
    (real 9-10), a sedan 12.2 (11.2-12.2), a pickup 14.6, a bus 25.6.
    The lock is speed-sensitive by construction (r = v^2 / grip): a touch
    stick or key at full deflection is the grip limit at any speed.
  - **Surfaces** (`SURFACES`, `v.surf` / `v.mu`): gravel mu 0.62 (+ rolling
    drag, ruts), grass 0.5 (+ the old turf drag). Gravel is a rail/sand lot or
    an **unpaved road**: `data/gravel.json` (tools/kw/build_gravel.py: OSM
    surface=unpaved/compacted/gravel/... on the roads build_roads keeps, 181
    polylines, 135 km of the townships' concession roads), `src/gravel.js`
    tags each edge along one (`e.gravel`, now from citygen, before the
    country roads: see "The country roads" below -- a gravel road is a rural
    one, no kerbs, crowned, tracked) and gives `city.gravelAt(x, z)`
    (asked every 0.12 s). The lock asks sqrt(mu) of the surface's grip, so a
    full lock on gravel pushes and slides. **Stability control**: the pull
    is held under what the driven tyres need for the bend (`latAcc` or the
    wheel's ask; `ESC_LOOSE` of it on gravel / grass), so a floored touch
    GAS slides, it does not spin. **On asphalt too (v79)**: `ESC_ROAD` of
    the bend, only once the car is turning (`ESC_BEND`: a straight launch
    keeps all its pull, 0-100 unchanged), and the pull is cut as the drift
    passes `ESC_SLIP0` 4 deg (to its floor by 11 deg) -- before v79 the
    spawn's red sports car, floored with a third of the lock, spun round
    (its spinning rears kept 30 % of their sideways grip). Now the tail
    steps out ~5 deg at a third of the lock, 11-17 deg at full lock, and is
    caught: `DRIVE_TRACE=launch:sports[,surface,steer] node
    tools/kw/drivetest.mjs` (4 s from rest, full throttle, per stick
    deflection: degrees turned, worst drift; before 83-87 deg from 0.35 of
    the lock, after <= 17). main.js's `surfaceAt` says 'gravel' on those roads
    (the crunch loop) and the skid emits dust there and on grass.
  - **Traction**: the driven axle's load share (RWD 0.5 + squat, FWD 0.6 -
    squat, EV all four) x grip caps the drive; past it `v.wheelspin` (the
    squeal in audio.js reads it now, not a power guess; marks; dust). A sports
    car lights its rears off the line, anything does on gravel or grass.
  - **ABS**: the brake is held under the friction circle left after the
    cornering (`v.abs`); a stop in a bend still steers, gravel stops ~50 %
    longer, and an ABS stop chirps rather than howls.
  - **Gearbox** (`_gearbox`, `v.gbox`): the car's engine profile's own gears
    (audio.js ENGINES via selectEngine -- vehicles.js imports them), up at
    52-94 % of the redline by throttle, kick-down, a torque curve per gear
    (normalised so the class's 0-100 barely moves: +0.3 s for the shifts)
    and 0.16 s with no drive per upshift (0.32 diesel): the squat lets go and
    comes back. Engine braking by the revs. **audio.js EngineModel follows
    `gbox`** (step's `gb`), so the shift you hear is the one you feel.
  - **Body**: roll at the limit by roof height (sedan ~3.4 deg, sports 2,
    pickup/van/bus 6.5) as a share of the grip in use, not raw g; dive
    ~2.5 deg under a full stop, squat 60 % of it.
  - **Acceleration stays arcade** (ARCADE_PUNCH 2.4, shared with the AI and
    the police, so chases stay balanced): 0-100 is ~half the real figure
    for every class, the ratios real. Braking likewise (ARCADE_BRAKE 2.2).

  Measured with **`node tools/kw/drivetest.mjs [types] [--json f] [--compare f]`**
  (flat ground, fixed 60 Hz, `v.update` with the player's detailed model;
  `surfForce` pins grass/gravel; `DRIVE_TRACE=type,surface,kmh` prints a
  full-lock hold frame by frame; `--live` drives the real loop on a gravel
  road with GAS held and real D-key events, printing gear / audio gear /
  surface). Before -> after (game numbers; real road-test figures in
  brackets; lat g at FULL lock with the speed held; handbrake = 0.5 s pull
  with full lock at 60 km/h, then 1 s straight):

  | | sedan | sports | pickup | compact | bus |
  |---|---|---|---|---|---|
  | 0-100 s (bus 0-80) | 3.75 -> 4.02 (6.5-8.5) | 1.90 -> 2.20 (3.5-4.5) | 3.68 -> 3.95 (6-8) | 5.58 -> 6.00 (10-14) | 13.9 -> 15.7 (20-30) |
  | top km/h | 205 -> 204 (200-240) | 275 -> 272 (280-310) | 185 -> 185 (170-180) | 170 -> 170 (155-175) | 95 -> 94 (90-105) |
  | 100-0 m | 18.4 = (36-41) | 15.2 = (31-34) | 20.7 = (40-46) | 19.8 = (39-44) | 24.0 = |
  | dive / squat deg | 1.4 / 0.8 -> 2.4 / 1.0 | 1.5 / 1.2 -> 1.9 / 0.8 | 2.8 / 1.9 -> 3.4 / 1.4 | 1.3 / 0.6 -> 2.3 / 1.0 | 3.2 / 0.8 -> 3.4 / 1.4 |
  | lat g @60 (radius m) | 3.16 (9.0) -> 2.24 (12.6) | 3.57 (8.0) -> 2.58 (11.0) | 2.76 (10.4) -> 1.96 (14.5) | 2.96 (9.4) -> 2.05 (13.6) | 2.32 (12.2) -> 1.24 (22.9) |
  | lat g @120 [real skidpad] | 3.23 -> 2.33 [0.85-0.92] | 3.69 -> 2.68 [1.0-1.1] | 2.83 -> 2.06 [0.72-0.8] | 2.99 -> 2.08 [0.78-0.84] | -- [0.4-0.5] |
  | roll @60 deg | 1.8 -> 2.6 | 1.9 -> 1.7 | 3.6 -> 4.7 | 1.7 -> 2.4 | 4.1 -> 5.3 |
  | turning circle m | 12.8 -> 12.2 (11.2-12.2) | 11.3 -> 11.2 (10.6-11.4) | 14.6 -> 14.6 (13-15) | 12.6 -> 9.9 (9-10) | 24.2 -> 25.6 (23-25) |
  | full-lock step @80: yaw t90 ms / overshoot | 167 / 0 % -> 200 / 2 % | 150 / 0 -> 183 / 1 | 183 / 0 -> 233 / 1 | 150 / 2 -> 167 / 5 | -- |
  | lift-off at the limit @90: drift deg, yaw | 2.7 -> 5.1, +25 % -> 3.2 -> 5.5, +20 % | 2.6 -> 5.1, +28 % -> 3.2 -> 5.5, +22 % | 2.7 -> 5.0 -> 3.3 -> 5.4 | 2.6 -> 5.6 -> 2.9 -> 5.6 | -- |
  | handbrake: deg turned, km/h after | 107, 10 -> 88, 21 | 127, 3 -> 135, 6 | 64, 20 -> 44, 30 | 117, 1 -> 125, 4 | -- |
  | grass: top, 100-0, lat (held km/h) | 69, 14.1, 2.56 (40) -> 54, 22.7, 0.92 (24) | 103, 12.0, 3.11 -> 67, 20.0, 1.11 (25) | 69, 15.4, 2.25 -> 50, 24.5, 0.80 (24) | 55, 14.9, 2.29 -> 55, 23.8, 0.68 (22) | 29, 17.2 -> 28, 26.8 |
  | gravel: top, 100-0, lat @40 | 205, 18.4, 2.68 -> 166, 27.8, 1.22 | 275, 15.2, 3.02 -> 232, 23.2, 1.38 | 185, 20.7, 2.32 -> 155, 31.1, 1.08 | 170, 19.8, 2.56 -> 136, 29.8, 1.06 | 95, 24.0, 1.42 -> 76, 35.7, 0.98 |

  A hard hit (spin 2.8 rad/s, 6 m/s sideways at 54 km/h) settles in
  1.4-1.6 s (was 1.5-1.8) and turns the car ~150 deg (was ~210). Phone
  (AUTO_PHONE=1, GPU) at the opening frame: 198 -> 199 draws, 892k tris both
  (nothing new is drawn; the gravel tint is vertex colour and one shader
  branch).
- **Driving feel, round two: every type its own** (docs/drive-crumple.jpg,
  drive-cam-semi.jpg, drive-cam-civic.jpg). Still only YOUR road car
  (`spec.roadCar` + `detailedWheels`); the AI and the other machines are
  untouched.
  - **Engines** (audio.js `HAND_ENGINE`, checked by `hand` before the flags,
    which gave the dually and the semi the BUS's diesel and air brakes, the
    U-Haul the bus's too, the OPP the muscle car's V8): `vtec` the Civic's
    7,400 rpm four, `pdiesel` the dually's turbo-diesel six (injection
    clatter, a turbo whistle, no air brakes), `bigdiesel` the semi's 15 L six
    (600-2,100 rpm, ten gears, air brakes, the **jake brake**), `v8work` the
    U-Haul's gas V8 (no crackle, no blip), `v6` the Wrangler, minivan, suv3
    and the OPP's Interceptor; crossover / compsedan / wagon keep the i4,
    the pickups the V8, the EVs the motor. The gearbox (vehicles.js) uses
    the same tables, so each type shifts as it sounds; it **skip-shifts**
    when far over the revs (taken over at speed) and a `jake` box holds its
    gear off the throttle. **Jake brake**: `EngineModel.jake` (off the
    throttle over ~29 km/h, in gear, revs over 45 %) voiced as a gated bark
    at the firing rate (EngineVoice.apply), felt as `JAKE_A` 1 m/s^2 more.
  - **Tyres**: they SING from 85 % of the cornering grip (`gripUse`, a
    thinner note under the slide's squeal); gravel's crunch as before.
  - **src/roadfeel.js** (`RoadFeel`, main.js before audio): bridge joints
    on a deck every ~32-36 m and the approach slab at each end (front axle,
    then rear wheelbase/speed later; audio.js's own joint ticker stands
    down for your road car: `feelJoints`), **ION's rails** (each track within
    8 m: the signed distance of each axle from the centreline against the
    two rails at +-0.7175 m; flush street rails softer than a crossing's;
    at the track's height only) -> `railbump`, and **the rumble strips**
    (highways.js `rumbleAt`: every drawn stretch filed in 40 m cells, the
    build's own offsets and heights) under each side's wheels -> the
    `rumblestrip` loop at speed / 0.3 m / 80 Hz, a shiver in the body and
    the view. All kick the car through `Vehicle.bump(amp, axle, side)`.
  - **Suspension per type** (`SUSP`: natural frequency, damping, roll and
    pitch gain, travel to the stops; roll/pitch springs 10 % stiffer than
    heave): a sports car 1.95 Hz, family cars 1.3-1.5, the Wrangler 1.05 Hz
    with the most roll (x1.3) and 16 / 12 cm travel, the U-Haul's high box
    x1.3 roll, the semi's air-ride cab 0.95 Hz. **Heave** (`susHeave`, the
    tilt group's y, the wheels held down): driven by the floor's vertical
    ACCELERATION as the wheels follow it (smoothed over the wheelbase's
    passing time, x0.6 for the tyres' give: the 40 m terrain's grade
    breaks threw the body to its stops unsmoothed), a landing's speed, and
    bumps. A stop reached hard is `bottomed` (the `bottom` clunk). Over
    ~0.5 km of real hilly road at 80 km/h: sedan -3 / +7 cm, Civic -2 / +5,
    Wrangler -6 / +13, U-Haul -4 / +9, semi -4 / +8, no bump stop hit.
  - **The chase camera** (player.js): road cars' boom from size --
    `6.9 + 0.5 len` back, `2.25 + 0.95 roof` up, the look point up with
    the roof -- plus `CAM_TYPE` (the Civic and sports car low and close,
    the U-Haul and dually back); **the semi with its trailer** 26-28 m back
    and ~9 m up, over the trailer's roof to the road ahead. **Speed FOV**
    +7 deg from ~70 to ~190 km/h (an offset on whatever fov an activity
    set: `_fovSet`) and a fine tremor past ~100 km/h, more on gravel and
    grass. **Touch:** a finger on the look zone holds the view (it swung back
    as soon as a dragging finger stopped moving), recentring 0.9 s after
    the last look, the pitch back to the chase height 2 s after.
  - **Handling**: the rig (`laden`, a tractor with its trailer) pulls
    with `RIG_DRIVE` 0.78 of the drive (back to 1 toward the top), stops
    with `RIG_BRAKE` 0.72 and coasts on `RIG_COAST` 0.55 of the engine
    braking; the trailer is kinematic (traffic.js `follow`), so it
    articulates like a real one and cannot jackknife under braking. The
    pedal's answer (`_thrD`): an EV's torque in 0.03 s, a petrol engine's
    0.12, a turbo's 0.22, a diesel's 0.35-0.4 -- the EV's 0-50 is 0.7 s
    against a sedan's 1.9.
  - **Crashes**: `Vehicle.dent` puts a crumple where the hit landed
    (`hitX/Z`, set by traffic.js `wallImpulse` and `carPair`): up to
    `DENT_N` 4 dents as uniforms on the car's own paint material and on
    clones of trim and matte made at its first dent (the SAME programs:
    a first crash compiles nothing), ~1.2 cm per m/s over 7, to 32 cm, a
    per-2.5 cm-cell hash so the panel crinkles; the creases catch the light
    (normals knocked by another hash). A hard hit on the nose holes the
    radiator (`steamT`: white steam a few seconds); under 25 % health the
    smoke doubles, under 33 % the engine misfires. The crash sound is by
    ENERGY: impact x sqrt(the pair's reduced mass / two cars'), so a semi
    into a car is a tier up. Not on the Hellcat's wrap, the Wienermobile
    or the airliner (their own paint shaders); the far LOD is undented.
  Measured: `node tools/kw/drivetest.mjs <types>` (now also 0-50, 80-120
  floored, and for a rig its articulation: lane change at 90 7 deg, full
  lock at 30 / 60 / 90 77 (the 77 deg cap, R 8.6 m) / 39 / 18 deg, a hard
  stop in a bend from 90 32 deg, reversing 1 deg) and **`node
  tools/kw/feelprobe.mjs <dir> [phases]`** (the live game: rumble strip on
  the 401 -- 1.9 s on the grooves, the loop on; three ION crossings -- 8
  rail hits each; a Conestoga Parkway deck; ~0.5 km of gravel and of hilly
  road per type; the engine per type; the semi's jake -- 0.82 mean, 2.3
  m/s^2 coasting at 80; the camera per type and the FOV at 170 km/h,
  66.7; a touch drag held and let go; a wall at 60 km/h -- a dent and
  steam; `dentshot` a before/after close-up). Before -> after (the game's
  numbers, flat ground, the player's model):

  | type | engine | 0-100 s | 0-50 / 80-120 s | top km/h | 100-0 m | dive / squat deg | lat g @60 (R m) | roll @60 deg | step@80 t90 ms / over % |
  |---|---|---|---|---|---|---|---|---|---|
  | sedan | i4 | 4.02 -> 4.12 | 1.87 / 2.33 | 204.4 | 18.4 | 2.4 -> 2.43 / 1.02 -> 0.95 | 2.24 (12.6) | 2.55 | 200 -> 183 / 2 -> 1 |
  | compsedan | i4 | 4.45 -> 4.57 | 2.03 / 2.42 | 199.4 | 18.4 | 2.17 -> 2.16 / 0.92 -> 0.85 | 2.13 (13.2) | 2.16 | 183 -> 167 / 3 |
  | civic | vtec | 4.15 -> 4.42 | 1.9 / 2.28 | 199.5 -> 198.4 | 17.5 | 2.16 -> 2.08 / 0.92 -> 0.81 | 2.22 (12.7) | 2.16 -> 2.05 | 183 -> 167 / 3 |
  | crossover | i4 | 4.52 -> 4.62 | 1.97 / 2.45 | 189.5 | 18.9 | 3.03 -> 3.14 / 1.29 -> 1.23 | 2 (14.1) | 3.49 | 183 -> 167 / 3 |
  | suv3 | v6 | 4.28 -> 4.38 | 1.87 / 2.27 | 194.5 -> 194.2 | 19.3 | 3.09 -> 3.24 / 1.31 -> 1.27 | 1.98 (14.3) | 3.57 | 183 / 2 |
  | minivan | v6 | 4.9 -> 5 | 2.1 / 2.73 | 184.5 -> 184.2 | 19.3 | 3.2 -> 3.33 / 1.36 -> 1.31 | 1.97 (14.3) | 3.75 | 183 / 3 |
  | wagon | i4 | 4.57 -> 4.68 | 2 / 2.42 | 194.5 | 18.9 | 2.74 -> 2.79 / 1.17 -> 1.09 | 2.08 (13.6) | 3.04 | 183 -> 167 / 3 |
  | jeep | v6 | 4.82 -> 4.93 | 1.97 / 3.07 | 159.7 -> 159.5 | 21.2 | 3.36 -> 4.45 / 1.42 -> 1.74 | 1.78 (15.9) | 4.06 -> 5.28 | 200 -> 183 / 3 |
  | pickup | v8 | 3.95 -> 4.07 | 1.78 / 2.25 | 184.6 | 20.7 | 3.36 -> 3.7 / 1.42 -> 1.41 | 1.96 (14.5) | 4.71 | 233 -> 217 / 1 |
  | pickupcap | v8 | 4.18 -> 4.28 | 1.8 / 2.35 | 179.6 | 20.7 | 3.36 -> 3.7 / 1.42 -> 1.41 | 1.93 (14.7) | 4.71 | 233 / 2 -> 1 |
  | dually | pdiesel | 5.43 -> 4.83 | 2.15 / 3.02 | 158.5 -> 159.1 | 22.6 | 3.37 -> 3.75 / 1.43 -> 1.37 | 1.3 -> 1.82 (15.5) | 3.28 -> 4.87 | 233 -> 250 / 16 -> 2 |
  | ev | ev | 1.5 -> 1.52 | 0.72 / 0.73 | 235 | 16.1 | 2.1 -> 2.01 / 0.91 -> 0.87 | 2.38 -> 2.39 (11.9) | 2.07 | 183 / 1 |
  | evy | ev | 2.22 -> 2.25 | 1.03 / 1.12 | 217 | 17 | 2.74 -> 2.63 / 1.2 -> 1.14 | 2.24 -> 2.25 (12.6) | 3.06 | 200 / 1 |
  | uhaul | v8work | 8.55 -> 7.55 | 2.65 / -- | 128.8 -> 129.2 | 23.1 | 3.37 -> 4.19 / 1.43 -> 1.64 | 1.25 -> 1.29 (22) | 5.18 -> 6.83 | 83 -> 117 / 6 -> 1 |
  | semi | bigdiesel | (0-80) 18.32 -> 24.18 | 12.32 / -- | 103 -> 102.8 | 28.7 -> 36.6 | 3.38 -> 3.44 / 1.44 -> 1.32 | 1.1 (25.5) | 5.32 -> 5.85 | 100 / 3 -> 0 |
  | opp | v6 | 3.05 -> 3.15 | 1.47 / 1.73 | 224.4 -> 224.1 | 17.5 | 3.08 -> 3.09 / 1.31 -> 1.21 | 2.1 -> 2.11 (13.4) | 3.55 -> 3.56 | 183 / 1 -> 2 |

  Phone (AUTO_PHONE=1, GPU): the spawn 210 / 1048k -> 212 / 1052k, in the
  car by the spawn 221 / 1059k -> 224 / 1055k (traffic and the new boom's
  framing; nothing new is drawn). Approximate: the jake is a voicing of the
  engine model, not a recording; a dented car's far LOD is clean; the
  dent ignores the wheels' own meshes (they keep turning true).
- **Waterloo Region's traffic** (vehicles.js; docs/fleet-*.jpg). **Grand
  River Transit** (`grtLivery`, `spec.grt`; checked against Commons photos
  of 21206, 21714, 21759, 22020, 2018-23): white, a royal-blue band under
  dark tinted windows with a gold line, the GRT wordmark on its white panel
  (blue italic, GRAND RIVER TRANSIT in gold), "Grand River Transit" on the
  band, the Region's V and the fleet number over the front windows, on the
  nose and the back. Types: `bus` (7 King, amber LEDs), `busx` (202 iXpress
  University), `ionbus` (302 ION Bus: no band, ION's blue front corners,
  windscreen frame and roof, the ion logo; a third of the `busx` draws in
  traffic.js), `artic` (201 iXpress Fischer-Hallman -- **GRT has never run
  articulated buses**: its Northfield garage was built for them in ~2020 and
  none were bought; 2024's business plan has them "on the back burner". It
  wears the livery but is NOT in CIVILIAN_TYPES -- its slot became a `bus`).
  **Lettering is `dotText`**: a 5x7 dot-matrix font (`DOT5`, upper and
  lower case, digits, `- / . ' &`) merged into runs per row, flat on a
  panel by centre / right vector / up; `led` gaps the rows, `bold`,
  `slant`. LED signs are over-bright vertex colours (`LED_AMBER` 2.4) in
  matte, so a sign in the shade still reads -- in `trim` (metal) they were
  dark. **Ontario plates** (`plateBox`, every `trim.box(..., PLATE)`
  became one): white, a blue ABCD 123 serial with the crown between, and
  ONTARIO / YOURS TO DISCOVER; **a serial per CAR** (see round two).
  **New types:** `minivan` and `wagon` (SMALL_LOOKS tables through
  `buildSmallCar`: the slider track, roof rails, clad arches), `crossover`
  and `compsedan` (`scaledBuild` of the SUV and the sedan at RAV4 / Civic
  size -- y is not scaled, so they keep their parents' heights), `pickupcap`
  (`spec.cap`: a cab-high cap over the bed), `schoolbus` (buildSchoolBus:
  a Type C conventional, chrome yellow, black rub rails, SCHOOL BUS and the
  red/amber lamps front and back, the stop arm on the driver's side, the door
  behind the front wheel, STUDENT TRANSPORTATION on the sides; one CIVILIAN
  slot, never parked), `postvan` and `purovan`
  (`vanLivery`: Purolator's slashes and red italic wordmark on the generic
  van; **Canada Post's is its own van, see below**).
  **Canada Post** (docs/canadapost-stage.jpg: before over after;
  canadapost-city.jpg). What CP actually drives in Ontario: Ford Transit
  cargo vans (the 148" medium roof most), Transit Connects (bought from
  2010) and Utilimaster / Grumman step vans; the electric E-Transits
  (Nanaimo's 14 first) are the same body. Sources: Commons
  Category:Canada Post vans -- "Canada post ford transit.jpg" (Toronto
  2017), "CanadaPostVan7.jpg" (2014, the side the swoosh is read off),
  "CanadaPostVan.jpg" / "CanadaPostVan4.jpg" (Connects), "Canada Post
  Transit Connect St Mary St.jpg" (the back), the 2025 Gatineau step van
  (the logo, big). `postvan` is that Transit: `spec.van: 'transit'` makes
  buildVan read **`vanGeo`** (every station the generic van hard-coded,
  now a table; the generic `van` / `purovan` geometry is unchanged, 7568
  / 8024 tris before and after) -- 5.98 x 2.06 x 2.56 m, 3.76 m wheelbase
  (Ford's figures), the tall short bonnet, the windscreen straight from a
  1.47 m cowl, the door glass from the B-pillar to the A-pillar's foot,
  the black bumper and three-bar grille, headlamps wrapping into the
  wings, blank rear doors, black steel wheels (`addWheel` kind `'steel'`,
  new). **`postLivery`**, all matte quads on the flank (no texture, no
  draw): the red swoosh rising from a point over the front arch, under
  the door glass and up the B-pillar to nearly the roof at the back, on
  its blue stripe (`P_TOP` / `P_MID` / `P_LOW`: heights over metres from
  the nose, read off the 2014 photo scaled to 5.98 m); the round logo
  (`cpLogo`: red disc, the white wedge and three bars, always pointing to
  the viewer's right) on the cab door; the navy wordmark panel high at the
  back, POSTES / CANADA - logo - CANADA / POST on the driver's side,
  English first on the kerb side; postescanada.ca / canadapost.ca / the
  1-800 number; a fleet number on the wings; the dark grey lower
  cladding; at the back the logo top right, the number top left, FREQUENT
  STOPS on yellow and red/white chevrons along the bottom. Stage
  (carshots): 8756 -> 10473 tris, L x W x H (mirrors) 5.48 x 2.58 x 2.29
  -> 6.21 x 2.63 x 2.57 m; still 3 draws. **Estimated:** every colour;
  the swoosh's edges (one photo, perspective); the panel and text sizes;
  the bilingual sticker is English only (DOT5 has no accents); rear-door
  glass left out (not seen in a photo); the 5x7 dot font stands in for
  CP's sans; the fleet number is one made-up number for every van.
  **Two-tone paint**: `finish: 'twotone'` (+ `paintVC` for the far LOD)
  makes the paint read its vertex colours, which every other finish
  ignores -- WRPS's cruiser (Commons WRPS_New_Car2, Wikipedia: navy hood,
  wings, quarters, trunk and bumpers, white doors and roof, WATERLOO
  REGIONAL / POLICE, the red line, the flag) recolours its paint vertices
  outside the doors; the ION Bus's front face is `tinted(paint, ION_BLUE)`.
  The taxi is white with WATERLOO TAXI and 519-888-7777 (the company's
  number; its car colours are unverified). **The mix:** `CIVILIAN_TYPES`
  is weighted like Canadian registrations and `CAR_COLORS` like a Canadian
  car park (50 entries: 13 white, 10 black, 10 grey, 5 silver, 5 blue,
  4 red, 3 others). traffic.js keeps every `spec.bus` off the kerb and off
  residential streets (`NO_KERB`), and LOT_TYPES / HEAVY know the new
  names. Verify on a plain stage in seconds: `node tools/kw/carshots.mjs
  <dir> [shots.json] [names]` (tools/kw/carstage.html; prints triangles a
  type); in the city: `VIEWS=tools/kw/carshow.json node tools/kw/kwshots.mjs
  <dir>` parks the fleet at Conestoga Mall (`carshow`, bus close-ups
  `bus-*`); `VIEW_PROBE_FILE=tools/kw/carprobe.js` reports draws, triangles
  and the type mix after 12 s of play. Phone: 16 vehicles parked in view
  cost +48 draws (3 each) and ~+8.5k triangles each (buses ~12-13k); the
  spawn frame (CLAUDE.md's 196 draws, 881k tris before) 199 draws, 889k tris.
- **Waterloo Region's traffic, round two** (vehicles.js, traffic.js;
  docs/fleet-carshow.jpg, fleet-trucks.jpg, fleet-highway.jpg,
  fleet-plates.jpg).
  - **Every car its own plate, for no draw and ~280 fewer triangles.** The
    plate's face is ONE quad whose vertex colours are its UV (red, green)
    and `PLATE_KEY` in blue; tagGlass flags it `glass` 4 and glassShader
    paints it from `PLATE_ATLAS` (plateAtlas: 128 serials, `plateSerial(k)`,
    a 1024 x 640 canvas drawn once at the plates' 3.1 : 1). WHICH serial is
    per mesh: Vehicle sets `trimMesh.scale.x = 1 + k / PLATE_STEP` (32768;
    k < 128, so under 0.4 %) and the vertex shader reads k back from
    modelMatrix (x column's length over y's, so a parent's uniform scale
    cancels). A per-mesh uniform cannot do it: trimMat is shared, and
    three.js re-uploads a built-in material's uniforms only when the
    material changes between draws. Anything that scales a trim mesh
    non-uniformly gets a random serial (tank.js's crush does). The far LOD
    draws plates plain white, and now keeps tinted glass (it dropped
    `glass` 3 along with the contact shadow: holes in far buses).
  - **Heights:** `scaledBuild(build, len, wid, [y0, ky, refRoof])` scales
    height above y0 only (wheels, arches and sills stay) and hands the
    builder its parent's roof. `crossover` 1.88 -> 1.72 m (RAV4 1.74),
    `compsedan` 1.50 -> 1.42 (Civic 1.415). carshots now prints each body's
    L x W x H (carstage `place` returns `size`); compare with the real car.
  - **New types** (real L x W x H in TYPES' comments): `suv3`
    (Highlander / Explorer: the SUV at 5.05 x 2.00 x 1.74), `evy` (Model Y:
    the EV's body, greenhouse grown above 0.62 m to 1.62; `ev` is the
    Model 3), `civic` (SMALL_LOOKS.civic: a fastback hatch, `sport`: the
    ducktail, black diffuser and centre exhaust, black wheels), `jeep`
    (buildJeep: Wrangler JL Unlimited from slabs -- `hexa` / `slabZ` are an
    8-corner solid with true face normals -- seven slots between round
    lamps, flat black fenders clear of the tyres, a near-upright framed
    screen, black hardtop, exposed hinges, rock rails, the spare;
    `offroad`), `dually` (buildDually: the pickup at F-350 size, duals
    under body-colour flares, cab clearance lamps; 6 wheels), `uhaul`
    (buildUhaul: E-series cutaway, Mom's Attic, white with the orange
    U-HAUL, MOVING & STORAGE, an Ontario SuperGraphic -- a lake, a white
    pine), `semi` + `semiTrailer` (buildSemi: a sleeper tractor -- long
    falling bonnet, bright grille, set-back fenders, raked two-piece
    screen, roof fairing, cab extenders, skirts, stacks, duals; buildSemiTrailer:
    the 53 ft van, posts, red/white conspicuity tape, skirts, swing doors,
    lock rods, ICC bar. The trailer is `towed` on `HITCH.semiTrailer`, the
    tiller's machinery; tractor colours by `liveries`), `opp` (buildOpp:
    `suv3` as the Police Interceptor Utility, the OPP's black with white
    doors -- the scheme since 2007 -- a crest, O.P.P., POLICE, push bar,
    spotlight, black steel wheels; `police: true`, so a player who takes
    one has the siren), `recycling` (Miller Waste, blue). `garbage` is
    now Emterra's (the Region's garbage / green bin contractor from
    March 2026): white, the green wordmark, the cart arm on the kerb side.
  - **Where they drive:** `CIVILIAN_TYPES` gains suv3 x3 (suv 6 -> 4),
    jeep, dually, civic x2 (hatch 3 -> 2), evy x2 (ev 3 -> 2), uhaul,
    recycling, and loses artic. **Highway only:** traffic.js turns
    `HWY_SEMI_P` 16 % of non-bus spawns on `hwy` edges into a semi and
    `HWY_OPP_P` 3 % into the OPP (at most `OPP_MAX` 2 about; its light bar
    on and dark -- policeLights only runs for units). `NO_KERB` keeps the
    semi and recycling off residential streets; LOT_TYPES / HEAVY know the
    new names.
  - **Handling** (drivetest.mjs, game 0-100 s / lat g @60 / circle m):
    crossover 4.5 / 2.00 / 11.1, compsedan 4.5 / 2.13 / 11.2, suv3 4.3 /
    1.98 / 12.1, civic 4.2 / 2.22 / 11.2, evy 2.2 / 2.23 / 12.2, jeep 4.8
    / 1.78 / 12.2 (and 160 km/h on grass: `offroad`), dually 5.4 / 1.82 /
    16.8, uhaul 8.6 / 1.26 / 17.4, semi 0-80 18.3 / 1.10 / 22.7 (105
    km/h governed, as Ontario's trucks are), opp 3.1 / 2.10 / 12.1.
  - **Verify:** `node tools/kw/carshots.mjs <dir> [shots.json]` (sizes and
    triangles); `VIEWS=tools/kw/carshow.json` (the fleet at Conestoga, new
    `carshow-trucks`); `VIEWS=tools/kw/highwayshow.json` (a staged 401
    with semis, the OPP, a U-Haul; `hwy-401-live` drives you onto it);
    `VIEW_PROBE_FILE=tools/kw/hwyprobe.js` (30 s on the 401: the type mix,
    semis and trailers spawned, orphaned trailers -- 7 rigs, 1 OPP, 0
    orphans, 0 exceptions). Triangles a type (occupied): jeep 5.6k, evy
    6.5k, uhaul 6.7k, semi 7.5k + trailer 6.7k, recycling 7.0k, garbage
    7.6k, dually 8.6k, civic 9.6k, opp 10.4k. Phone (AUTO_PHONE=1, GPU,
    carprobe at the spawn): 208 draws / 934k tris before, 207 / 935k after
    (traffic's own noise); each vehicle is still 3 draws (an OPP on patrol
    +3, its light bar, as a unit's).
- **The sights: src/kwsights.js** (`data/sights.json` from
  `tools/kw/build_sights.py`; docs/sights-*.jpg). Everything kwplaces.js
  does not: each landmark from its OSM footprint, found by centroid
  (`SIGHTS`, nearest within 12 m; the script asserts all are found).
  `prepSights` flattens every box under a footprint it draws (`kw.skip`,
  h 0, and `kw.poly` deleted so no storefront sign hangs on an undrawn face;
  kw.js's `LM_SIGNS` loop now skips `kw.skip` boxes); `buildSights` is one
  landmarks.js extra built with **kwplaces.js's `Kit`** (exported at the end
  of kwplaces.js: the same two vertex-coloured materials, so a cluster
  holding both modules' pieces is still one draw each) and its **own
  `PlaceAtlas` (2048 x 1536)** -- the places atlas is full. Keep panels at
  ~24-26 px/m (`text`, `brandPanel`); a tall panel (a stack's letters, a
  banner) sets its whole atlas row's height, so give those ~13-16 px/m.
  `__kwSights.atlas.full` must be 0 and `__kwSights.err` empty.
  `block()` is the generic footprint building (walls, parapet, cornice,
  plinth, windows `punch` / `grid` / `ribbon` / `curtain`); `frontEdge()`
  finds the face toward a named street. What is drawn, and from what:
  **Kitchener City Hall** (KPMB 1993: red Indian sandstone over a green
  stone band, the Civic Rotunda's drum with its frosted ring in green
  copper, the Berlin Tower's open steel cube and beacon mast; Carl Zehr
  Square's granite and the fountain pool OSM maps in it -- no clock: the
  clock tower people remember is the 1924 hall's, in Victoria Park);
  **King St downtown and Galt's Main / Water / Ainslie St** go through
  kwplaces.js `meshKing` (`sights.king`, the shops OSM maps in each; Galt's
  have `pal: 'stone'`, the limestone `STONES`); the **Market** (brick, the
  glazed atrium on King); **Centre in the Square** (fly tower); the
  **Breithaupt Block** (Google's four-colour wordmark on the 1903 factory
  and the 11-storey tower); the **Tannery** (arched windows, the 55 m stack
  off Joseph St, LANG TANNING CO. painted on the brick, Communitech);
  **Kaufman Lofts** (Kahn's concrete grid over red brick, the carved
  KAUFMAN RUBBER CO. LTD. frieze, the KAUFMAN stack -- the stack's lettering
  is from memory, unconfirmed); **Bauer Lofts**; **Victoria Park** (the
  clock tower at OSM's clock node by the Gaukel St gate, its fountain, the
  pavilion's hipped roof, the boathouse, the island shelter, Queen
  Victoria); **Schneider Haus**; **the Aud** (concrete, barrel roofs over
  its two lobes, KITCHENER MEMORIAL AUDITORIUM on the East Ave face, THE AUD
  over a red canopy, Rangers banners); **CF Fairview Park** and **the
  Boardwalk**, both checked against the Esri World Imagery aerial (2026):
  Fairview's zones (`FAIR_WALMART` / `FAIR_BAY` / `FAIR_SEARS` quads off the
  aerial: Walmart's grey front under a blue fascia, the Bay's empty dark
  brick box, the Sears wing split into Winners / Sport Chek / Mark's / RBC),
  the clerestory down the concourse with glass pyramids over the courts,
  the glazed main entrances (`atriumEntrance`), the red paving at the south
  doors, the pylon on Fairway Rd; the Boardwalk's two-tone stucco on a
  stone base, an entrance tower with a hipped metal roof per store
  (`storeFront(..., 'tower')`), pergola walks on the strips, the fountain
  court; **Bingemans** (the conference centre; Big Splash's wave pool,
  tower and six slides fanning DOWNHILL -- the direction is found from the
  terrain); the **Waterloo Region Museum** (white roof; the 16-colour
  glass quilt on every face toward Homer Watson Blvd) and **Doon Heritage
  Village** (every small unnamed building in `DOON` as clapboard / brick /
  red barn); **Homer Watson House**; **Toyota** (white panels, rooftop
  plant, the red TOYOTA logo toward Fountain St, the gate's monument);
  **Cambridge**: the Mill, the Old Post Office (mansard, the copper clock
  tower, the 2018 glass pavilion on the river side), the Main St bridge's
  bowstring arches (on the deck's edges, no solids), the Forbes mill.
  **Conestoga Mall** (kwplaces.js) got the same aerial check: the two
  octagonal courts (`MALL_COURTS`), the corridor clerestory and Zehrs'
  solar roof (`ZEHRS_SOLAR`). `sightsMap()` adds every one to the map.
  `window.__noSights = true` before boot (kwshots `VIEW_BOOT_JS`) turns it
  all off for a before/after. To check a place against the aerial:
  `tools/kw/aerial.py <out.jpg> x z [half] [zoom]` (Esri World Imagery,
  north up, the game's grid marked). Phone (AUTO_PHONE=1, GPU), off -> on:
  the spawn 196 -> 196 draws; City Hall from across King 200 -> 206 draws,
  896k -> 949k tris; King St downtown 376 -> 397, 977k -> 1018k;
  Fairview 368 -> 394, 994k -> 1080k (a wide view: three new materials in
  each 1200 m cluster it sees -- the pieces, the decals, the atlas); Galt
  141 -> 146, 621k -> 659k; the Boardwalk 74 -> 77. 0 exceptions.
- **The freeways** (src/highways.js, `data/hwy.json` from tools/kw/build_hwy.py;
  docs/hwy-*.jpg): the Conestoga Parkway (7/8, 7, 85), Hwy 8, the 401, Hwy 7/8
  west, as Ontario builds and signs them. hwy.json is OSM's: every
  motorway/trunk carriageway (ref, maxspeed, lit), every EXIT (a link leaving a
  motorway: junction:ref -- the 401's 268-286; **the Conestoga's exits are
  unnumbered**, `noref` -- destination, destination:ref, destination:street,
  from the ramp or the ramps it splits into, and the side it leaves by) and
  every entrance. Re-run build_hwy.py after a new cut of kw.osm.pbf.
  `prepHighways` (before traffic) matches each `hwy` edge to its carriageway
  (`INFO`) and sets `e.spd` = maxspeed + 10 km/h (90 Conestoga, 100 Hwy 8,
  110 on the 401). `buildHighways` (a landmarks.js extra, but its meshes go in
  its OWN group, `highwaysRoot()`, in 1.5 km cells shown only within
  `FURN_R` 1200 / `SIGN_R` 900 m of the camera by `updateHighways` in
  draw(): as landmark clusters it cost +76 draws looking down Hwy 8, as
  every cluster in the frustum drew it). Its geometry is vertex-coloured in
  kw.js's `polyMat()` (one material, no casting); signs are one more draw a
  cell, from their own 2048 x 1024 canvas (`SignAtlas`; the small panels
  are drawn first so a full atlas can only cost a guide sign).
  **The median:** every 10 m of a one-way `hwy` edge, the opposing
  carriageway to its left (`gap` = inner edge to inner edge); 1-18 m apart
  gets the paved median and the 1.07 m Ontario Tall Wall on the midline,
  drawn by the lower edge index of the pair (each sample decides, so pieces
  can meet with a seam). Not on Hwy 85 north of z -2150 (the barrier ends
  "just past Lancaster", Wikipedia; a grass median after). The walls are
  landmark solids with `mono` (AI traffic is not shoved by them) added
  AFTER buildLandmarks (`addHighwaySolids`): its on-road test counts a
  freeway's embankment (`pbw`) as road and dropped them. Twin davit poles
  every 50 m on the wall where OSM says lit=yes, else single ones off the
  right shoulder. **Signs:** per exit an overhead cantilever 300 m before
  the diverge (exit tab, King's crown shields for provincial routes, the
  white flowerpot for Regional Roads, the direction once after a
  concurrency -- "7 8 WEST" -- the streets and control cities, abbreviated),
  the same panel on posts at 1 km over a "1 km" plate, and the green EXIT
  sign in the gore (the first spot 60-240 m on clear of every carriageway,
  `onCw`: city.onRoad counts the embankment). After each entrance a MAXIMUM
  sign at ~180 m and a route marker at 420 m (`AXIS`: which way is EAST /
  NORTH per route). OSM's two `wall=noise_barrier` lines are noise walls.
  **Paint (world.js meshRoadMarks):** broken white 3 m / 6 m lane lines at
  the boundaries of the lanes traffic.js `laneLatU` lays (0.8 m in, floor(w
  / 3.6) lanes), a yellow left edge line on every one-way `hwy` edge and
  every ramp. Verify: `sh tools/kw/hwyshots.sh <dir> [prefixes]` (boots
  once for `window.__hwy.views` -- each sign's viewpoint -- then shoots
  them; `window.__hwy` has the counts; `window.__noHwy = true` before boot
  turns the furniture off for a before/after). Phone (AUTO_PHONE=1, GPU),
  __noHwy before -> after: Conestoga at Fairway 200 -> 203 draws, 584k ->
  586k tris; Hwy 8 at King 405 -> 405; Hwy 85 at King N 235 -> 240; the 401
  at Hespeler 116 -> 121. Build ~50-70 ms on the Mac (~230 ms with round
  two's rails and rumble strips). Not done: overhead lane-use arrows (the
  wall ends' crash cushions came in round three).
- **The freeways, round two** (docs/hwy-pkwy-noisewall-traffic.jpg,
  hwy-85-cutting-bridgeport.jpg, hwy-8-guiderail-rumble.jpg,
  hwy-pkwy-parapets.jpg):
  - **The right-of-way is mown.** `hwyKeepClear` (highways.js, in
    `city.extraClear`) keeps every tree 15 m past a freeway's shoulder (9 m
    past a freeway ramp's -- `freewayRamps`: ramps reachable from an `hwy`
    edge, not a town's slip lanes). build_wood.py paints the same band into
    surface.png as farm code 240 (`geo.farmAt` 8): no crop (crops.js, whose
    far blocks are flat-topped beige walls -- "the beige slab beside Hwy 7/8
    west") and no township parcel grows to the embankment; groundTint and
    cropAt skip code 8, so it is plain verge grass.
  - **Guide rail, masts, rumble strips** (buildHighways, furniture cells):
    W-beam on posts every 1.9 m at the shoulder's edge where the batter drops
    more than `RAIL_DROP` 2.6 m and within `BRIDGE_RUN` 60 m of a deck (along
    freeway edges from every deck end), never on a left shoulder with the
    tall wall beyond it; each piece a `mono` landmark solid. High masts (30
    m, a ring of six luminaires) over the freeway-to-freeway interchanges,
    found from hwy.json's exits whose destination is the other freeway
    (401/8, 8/Conestoga): a dozen per interchange, 12-60 m off the
    carriageways, ~160 m apart. Right-shoulder rumble strips (one groove
    drawn per 0.9 m) on the 401, 8, 7/8, 7 and 85.
  - **Parkway noise walls** read off Esri imagery (`PKWY_WALLS`: stretch +
    side, laid 4.5 m off the outer carriageway's edge, broken at ramps):
    Forest Heights, both sides east of Westmount, Ottawa St S to Homer
    Watson, by Kingsdale. Views `noise0..` in hwyshots.
  - **Deck parapets are F-shape concrete** (world.js meshGradedDeck): toe,
    sloped lower face, near-vertical wall; one flat slab read as a blue-grey
    board in shade.
  - **Three old bugs, root causes:** (1) grass spikes along both walls of
    Hwy 85's cutting at Bridgeport (-770, -2400): a freeway dip's carve
    started its bank ON the wall line, so terrain patch quads (4 m) straddling
    the wall drew grass faces in front of it -- citygen `FWY_DIP_OVER` keeps
    full depth one quad past the wall (world.js's CUT_OVER, same law), the
    wall's top is the ground past the ledge, a verge cap closes the ledge.
    (2) the bright band down Hwy 8 by King St: the road texture's polished
    wheel tracks (roughness map, 26 % / 74 % of a 9 m two-lane tile) laid
    across a 4-lane carriageway reflected the low sun -- freeway asphalt is now
    laid in one strip per lane and shoulder, each on the texture BETWEEN the
    tracks (`laneStrips`, world.js), shoulders a shade darker. (3) the beige
    slab: crops, above.
  - **Freeway AI** (traffic.js "freeway driving", gated on `traffic.fwy`:
    every `hwy` edge and the ramps reachable from one; city traffic runs
    the same code as before): every ~0.5 s a freeway driver (`fwyDecide`)
    may plan an exit (`fwyPlanExit`: the next diverge 260-1300 m ahead, 30 %
    of drivers take it; otherwise `pickNextEdge` keeps a freeway car on the
    freeway, `fwyOn`), move over for it, for a lane that ends (the route jogs
    > 2.2 m sideways at a node into fewer lanes; with no gap the lane's end is
    a standing leader, `dropT`) or for a semi in the left lanes (semis keep
    to the right two, capped at 105 km/h), pass on the left when held up
    (MOBIL gain `LC_GAIN`), and keep right when it costs nothing. Safety is
    IDM braking: no change asks more than `LC_SAFE` 2.5 m/s^2 of the new
    follower or of the car itself. Neighbours are put in the driver's own
    edge frame, bent for the curve (`fwyNeighbours`). A change re-plans the
    route in the new lane and carries `lcShift` (the old offset) that runs
    out over `LC_TIME` 3.2 s, applied to the pursuit point and to the scan
    path; a car changing INTO a lane is a leader there from the start. On a
    ramp the merge yields (`fwyMergeGap`): the main-line car in the lane
    joined that will reach the merge first (or within 1.5 s after) is a
    leader with its gap measured to the merge. Freeway spawns land in a gap
    at their own pace. Bicycles, school buses and refuse trucks never spawn
    on a freeway or its ramps and route off them (`FWY_BANNED`).
  - **Verify:** `sh tools/kw/hwyshots.sh <dir> rail,mast,noise,air` and the
    fuzz probe: `VIEW_PROBE_FILE=tools/kw/hwytraffic.js node
    tools/kw/kwshots.mjs /tmp/x` (fixed dt 1/60, the game paused, spawns held
    to freeway edges, six sites x 150 s; `window.__hwyt = {all: true, sites:
    [...]}` in VIEW_BOOT_JS for city traffic). Master vs this: AI-AI body
    overlaps 36 -> 3-5 (all at ramp merge/diverge geometry: the 401 at
    Hespeler's ramps, the Parkway at Fairway, Hwy 85's ramps), crashes 7 ->
    0, stuck 0 -> 0, mean freeway speed 70 -> 92 km/h (free-flowing cars
    0.86 of the edge's traffic speed), right lane ~55 % of car-time on a
    3-lane carriageway (was 31 %), semis in the right two lanes 100 %. City
    sites (uptown, downtown, Fairview): 5 -> 4 overlaps, unchanged. Phone
    (AUTO_PHONE=1, GPU), master -> this: spawn 204 -> 205 draws; Parkway
    noise wall 428 -> 428, 1157k -> 1153k; 401 at Hespeler 310 -> 309, 460k
    -> 473k; the 401/8 masts 366 -> 366, 497k -> 535k; Hwy 8 at King 173 ->
    173, 542k -> 560k; Fairway aerial 219 -> 219. 0 exceptions.
- **The freeways, round three** (docs/hwy3-*.jpg, master over this):
  - **Overpasses stand up.** The survey's worst finding: nearly every
    street over a freeway lay ON it (0-0.4 m: Hespeler, Franklin, Townline,
    Fountain, Speedsville over the 401; Fischer-Hallman, Notre Dame over
    7/8; Northfield, King, University, Lexington, Wellington over 85; the
    gradeRoads clearance pass refused 86 crossings). OSM maps only the span
    as bridge=yes, so the deck's ends were anchors and 6 m in 20 m was
    over MAX_CLIMB. citygen `markApproaches` grades the draped street running
    on from each end of a street deck that crosses a freeway/ramp (`e.app`;
    the deck chain `e.ovr`), through plain nodes and through ramp terminals
    (every other road there a graded ramp, which then climbs with it), to
    the first real junction or `APP_MAX` 240 m; cone `APP_GRADE` 6 %. Refused
    86 -> 8, every named street overpass now clears 5.9-7.7 m (a few 11 m:
    Wellington's stacked decks). Approaches draw as meshGraded road on a
    mown-grass batter; junctions.js `ok()` and arterial.js's two-way layout
    accept `app` edges (anything else keyed on `e.prof` -- trees, poles,
    parked cars, gravel -- treats them like the decks: nothing stands on
    them). `app`/`ovr` are in GRADE_EDGE_FIELDS (the grade boot cache).
    **Approximate:** approaches have no sidewalks; the anchor junction stays
    at grade, so where it is under ~45 m from the span the climb is steep
    (MAX_CLIMB 15 %); ramp terminals on an approach are graded nodes (no
    junction square, as on master they had no control either).
  - **Exit-only lanes.** build_hwy.py exports `xo` per carriageway: the
    trailing turn:lanes entries that only turn off (slight_right/right),
    where a link leaves from the way's last node -- 53 ways, nearly every
    exit's deceleration lane plus the 401's auxiliary lanes. prepHighways
    puts it on the edges (`e.xo`, direction-checked). ONE rule, two readers:
    world.js meshRoadMarks draws that lane's line as a continuity line (0.2
    m, 1 m dash / 3 m period); traffic.js fwyDecide moves a driver who is not
    exiting out of it (mandatory), never keeps right into it, and inside
    `XO_LATE` 90 m of the diverge takes the exit instead of cutting across
    (`fwyPlanExit(v, s0, force)`; stats.exitOnlyTaken). Changing lanes at the
    gore instead jammed Hwy 8 at King (bus and semi locked overlapping,
    unseeded hwytraffic 87 -> 51 km/h there) -- keep the late cut-off.
    **EXIT ONLY:** where the dropped lane runs `XO_SIGN` 450 m+ (or two lanes
    drop) the overhead sign hangs a black-on-yellow EXIT ONLY band with a
    down arrow (one shared atlas panel, `onlyPanel`; the sign atlas is 984 of
    1024 rows -- per-sign variants overflowed it, `atlas.full` 0 -> 191).
    11 exits.
  - **Crash cushions** at every tall-wall run end (a piece end no other piece
    continues within 14 m, with room in the median): yellow stepped bays,
    black nose with yellow bars, a solid; in the furniture cells' one
    vertex-coloured draw. 262 -- many are the ends of the short wall runs
    where OSM's carriageways come within MEDIAN_MAX of each other.
  - **Not done:** paved 3 m right shoulders (the carriageway is lanes + 0.8
    m; widening hw ripples through grading, traffic lanes and medians), the
    401's concrete stretches (OSM says asphalt everywhere), km posts,
    overhead lane-use arrows, MTO slope paving under the abutments.
  - **Verify** (master -> this, one at a time on one port): trafficbench
    (rail off, phone) uptown-king, sig-1644, allway-28 = master;
    pkwy-fairway, 401-hespeler (exit-only AI, Hespeler Rd now over the 401)
    and rb-3lane (beside the Parkway at Homer Watson: the exit-only lane and
    the raised Homer Watson approach) change, meant. hwytraffic seeded 3
    hits / 0 crashes -> 5 / 1, unseeded 9 / 0 -> 9 / 0, all at master's
    spots (the 401 EB Hespeler gore with its two-lane ramp, 85's Bridgeport
    ramp); mean freeway speed 92 -> 91 / 91 -> 90 km/h; exits taken 28 ->
    56 (39 of them drivers left in an exit-only lane). jcttraffic seeded 0 /
    0 / 0 = master. funprobe ALL OK. Phone (AUTO_PHONE=1, GPU, fresh
    profile): boot to running 9.6 -> 10.0 s; spawn 178 -> 173 draws (1137k
    -> 1122k; the difference is traffic); freeway views +2..+3 draws
    (Hespeler overpass 111 -> 114, Fischer-Hallman 261 -> 263, the 401 EXIT
    ONLY gantry 133 -> 136, Homer Watson 176 -> 179, Hwy 8 at King 166 ->
    169), the Fischer-Hallman aerial 308 -> 314. 0 exceptions.
- **The freeways, round four** (docs/hwy4-*.jpg, master over this):
  - **Paved shoulders** (citygen `shoulderWant` / gradeRoads, after the
    split-level trim). Surveyed on Esri (aerial.py): the 401 at Hespeler
    Rd has ~3 m of paved right shoulder (and a pale edge strip), ~3 m of
    left shoulder and a broad concrete median round the tall wall; the
    Parkway ~2.5 m. The carriageway was lanes + 0.8 m. Now each untrimmed
    side of a one-way `hwy` edge is widened to 3.0 m right on the 401,
    2.5 m elsewhere, 1.5 m left where no opposing carriageway is within
    19 m (with one, the median IS the left shoulder: highways.js paves it
    asphalt to `LEFT_SH` 2.5 m from the lanes and concrete beyond to the
    wall) -- never into a neighbour (a ramp alongside, half the gap to a
    parallel carriageway), tapered to nothing 30 m from a node where the
    freeway meets anything else. **`e.tw` is the paved edge, `e.ltw` the
    lane basis** (the old widths, byte for byte): oneWaySpan, laneStrips,
    the lane and edge lines and the rumble strips read `ltw`, so traffic's
    lanes did not move (trafficbench identical to master at all six sites
    with this alone). `e.shx` is the widest it got; `pbw` includes it (every
    onRoad / roadLift / clear-zone reach), groundAt pieces are filed by
    their widest side, the freeway dip's carve and trench walls reach
    `shoulderMax`, guide rail stands at the paved edge, signs and lights
    stand off it, highways.js `onCw` counts a side's own paved edge
    (`paved = false` for the rumble strips). A widened side is mitred at its
    own width at each node (world.js meshGraded / deckAt): cut off the line
    mitred at hw, every joint opened a crack across the carriageway. 265k
    m2 of shoulder on 2947 edges.
  - **The gores** (citygen `spreadGores`, traffic.js `goreOf` /
    `goreThrough`). Root cause of hwytraffic's side-swipes at the 401 EB
    Hespeler gore: OSM joins a link to the motorway's CENTRE line, so the
    two-lane exit left the middle of six lanes at 7 deg and its lanes lay
    across the main line's for ~100 m; a car taking it came off the right
    lane and jumped 7 m LEFT at the node (the route vertex finds no
    crossing within reach: a jog) across the lane beside it. Hwy 85 at
    Bridgeport is the merge twin (a ramp's lane over the right lane for 40
    m, and its car then merged into the MIDDLE lane, nearest the link's end).
    And the through lanes: 6 lanes into 5 at the node by nearestLaneU put
    two lanes into the one under the centre line. Fixed in the geometry:
    each ramp's plain nodes near a diverge or merge are moved out until its
    surface lies beside the main line's paved shoulder (251 nodes, at most
    13.4 m); the edge still touching the main line's node is the GORE EDGE,
    `e.gore` = [shift at start, at end] right of travel, from the main
    line's outer lanes at the node to the moved node -- gradeRoads slides
    its band by it on a straight grade (draped, it fell off the 401's 2 m
    fill within metres), traffic.js lays its lane line by it (routeEntry,
    fwySpawn, fwyNeighbours' targets), world.js paints nothing on it, no
    guide rail. At a diverge where the carriageway loses lanes the lanes
    that carry on keep their order from the side away from the ramp
    (goreThrough). 97 gore edges.
  - **MTO km posts on the 401** (22): a green "km" plate every km on each
    carriageway's right shoulder, the chainage interpolated between the
    numbered exits (Ontario numbers an exit by its km; each exit's two
    diverges averaged), run on at 1 km a km past the end ones. The plate and
    ten digit panels are shared atlas panels (81 panels, rows 984 = master,
    full 0). **Lane-use arrows:** an EXIT ONLY gantry hangs one yellow band
    with its down arrow over EACH lane that leaves (`xo`), at the lanes the
    paint lays (12 bands on 11 gantries).
  - **Verify** (master -> this, one at a time on one port, rail off for
    trafficbench): trafficbench uptown-king, sig-1644, allway-28 = master;
    pkwy-fairway, 401-hespeler, rb-3lane change (the gores; the shoulders
    alone left all six identical). hwytraffic seeded 5 hits / 1 crash ->
    1 / 0, unseeded 9 / 0 -> 2 / 0, none at Hespeler or Bridgeport (the two
    left are ramp-to-ramp and a merge at Fairway); mean freeway speed 91 ->
    91 km/h, Bridgeport 60 -> 67-70. jcttraffic seeded: rb-3lane (beside the
    Parkway's Homer Watson ramps) recycles one car, the rest = master.
    poleprobe 0 in a lane, = master. funprobe ALL OK. `sh tools/kw/hwyshots.sh
    <dir> km,401-282` for the posts and a gantry. Phone (AUTO_PHONE=1, GPU),
    master -> this: spawn 178 -> 178 draws; 401 at Hespeler gantry 177 ->
    176, 587k -> 586k; Fairway 220 -> 220; Homer Watson 259 -> 259; Hwy 85
    at Bridgeport 281 -> 281; the 401 from the air 181 -> 181. Freeway build
    192 -> 199 ms, its triangles 461k -> 477k. 0 exceptions.
  - **Approximate / not done:** the gore edge's drawn band crosses the main
    line's lanes near the node (it is the ramp; unpainted, under the
    main's lanes' paint); a 0.3 m slot shows between the main line's
    shoulder and a moved ramp; 5 of 213 ground signs (2 gore, 1 MAXIMUM, 2
    route markers) found no room beside the wider pavement, and guide rail
    is 12.8 -> 11.7 km (none on gore edges); km posts are a judgement of
    MTO's plate (no source found for its exact face); the 401's concrete,
    slope paving and through-lane arrows still not done.
- **The freeways, round five** (round four's leftovers; docs/hwy5-*.jpg,
  master over this):
  - **A ramp meets the main line at its paved edge** (citygen gradeRoads,
    after the shoulders: "A RAMP MEETS THE MAIN LINE"). For every graded
    one-way ramp sample beside a freeway carriageway at its level (within
    1.5 m, parallel to 0.8, not a split-level side), the ramp's side toward
    it is moved onto that carriageway's PAVED edge (`tw`, shoulders
    included): clipped back where the band lay over the main line (the gore
    edge slid onto the outer lanes, ramps joining at an angle), collapsed to
    zero width where the whole ramp is on the main line's pavement (an
    exit's taper now opens out of the shoulder), paved across where ground
    showed under `MEET_SLOT` 1.5 m (spreadGores' SH_GAP 0.3, the shoulders'
    SH_CLEAR, OSM's spacing). Past 1.5 m the gore is grass: its nose. A slot
    whose step is over `MEET_PAVE` 0.5 m is bridged by a grass batter instead
    (`meetG`, its width in dm). `e.meet` (per sample and side, NaN for none)
    is the height world.js meshGraded hangs a SEAM STRIP to: 0.35 m on under
    the main line's pavement, 6 cm below it, from the ramp's own edge
    vertices -- so whichever is higher, the step between the two meshes shows
    asphalt, never ground or a hairline. `e.meetGap` keeps the gap for every
    side with a main line beside it (the noses, below). Lanes (`ltw`) never
    move; `meet`, `meetG`, `meetGap` are in GRADE_EDGE_FIELDS.
    `cityStats.rampMeet`: 630 samples clipped, 2227 closed, 115 bridged, 98
    collapsed. `VIEW_PROBE_FILE=tools/kw/goreprobe.js` (master too): ramp
    band over the main line's pavement 9562 -> 136 m2 (what is left is round
    each node's mitre), ground showing between the two 10.2 km -> 0.9 km
    (most of it the 1.5-2 m noses; 0.46 km bridged by grass).
    `tools/kw/goreviews.js` prints `-air` / `-low` / `-top` / `-seat` views
    of all 97 gores (85, 401, 7/8, 8, 7, 6/7) for kwshots `VIEWS=`.
  - **Guide rail**: gore edges carry rail again on their outer side (a side
    paved to the main line -- `meet` -- or with no band of its own carries
    none: that is pavement, not a fill's edge), and a run under way carries
    on while the fill stays over `RAIL_KEEP` 1.9 m (it starts at RAIL_DROP
    2.6): round four's 1.1 km "lost" was 0.83 km now lying on the paved gore
    (correctly gone) and 0.42 km of borderline 2.2-2.6 m fills flipping off.
    11.7 -> 12.9 km (pre-round-four 12.8). **Gore noses** (`noses`: 58
    where a paved gore ends 1.5-8 m wide): where rail runs on into the wedge
    (both sides of it, on a fill) the rails' blunt ends get the yellow
    attenuator (the tall wall ends' `cushion()`, now shared), its nose just
    ahead of the most upstream rail end, on a concrete pad down to the
    wedge's ground; diverges only (nothing comes at a merge's nose). 3 noses
    qualify -- most gores are on flat ground, with no rail and so no
    attenuator, as MTO's are.
  - **Signs**: each ground sign tries its usual spot, then further on, then
    further out (gore 2.4 / 3.4 m out to 330 m, then 4.6; MAXIMUM and route
    markers 2.2 then 3.6 m off over five distances; km posts step out past a
    ramp paved onto the shoulder). Ground signs 208 -> 217 (adv 47, gore 48
    -> 50, MAXIMUM 59 -> 62, route 54 -> 58; round three had 213), km posts
    22 = 22 (21 before the step-out). No sign within 25 m of a nose
    attenuator.
  - **The 401's concrete: checked, not drawn.** Esri's aerial at Hespeler Rd
    (aerial.py 11000 4250) shows asphalt lanes with pale shoulders and the
    concrete median; no concrete pavement through Cambridge was found in
    the widening's press (MTO, Infrastructure Canada, 2017-2025).
  - **Verify** (master in a detached scratchpad worktree, one at a time on
    one port): trafficbench (rail off, phone) 5 of 6 hashes = master,
    401-hespeler changes (-1398473.998642 -> -1398474.386286, same count:
    the gores' surfaces there, meant); jcttraffic seeded byte-identical (0 /
    0 / 0 / 2 recycled); hwytraffic seeded 1 hit / 0 crashes = master,
    unseeded 2 / 0 = master (pkwy-fairway, pkwy-westmount lane changes).
    `VIEW_PROBE_FILE=tools/kw/hwysolidprobe.js` (every freeway solid's
    corners against the lanes): 49 = master (tall-wall pieces over a ramp by
    (1800-1970, 1890-1960), none of them new); poleprobe 0 in a lane.
    `sh tools/kw/hwyshots.sh <dir> nose,gore,spd,route`. Phone (AUTO_PHONE=1,
    GPU, seedrandom), master -> this: spawn 178 -> 175 draws (traffic), 401
    from the air 180 -> 179 (697k -> 693k), Fairway 217 -> 216, Hwy 85 from the air
    257 -> 256. Freeway build 204 -> 209 ms, 477k -> 485k
    tris. 0 exceptions.
  - **Approximate / not done:** where the paved gore stops is a fixed 1.5 m
    slot, not the painted gore's real nose; within each node's mitre a sliver
    of ramp still overlaps (136 m2 map-wide); a grass-bridged slot is a steep
    strip, not a graded batter; ramp-to-ramp gores are untouched (only main
    lines are met); nose attenuators only where rail is warranted; through-
    lane arrows and slope paving under the abutments still not done.
- **Junctions: signals, stop signs, roundabouts, crossings** (src/junctions.js,
  `data/junctions.json` from tools/kw/build_junctions.py; docs/junction-*.jpg).
  The graph has no node tags, so build_junctions.py extracts them: signal
  nodes clustered per intersection (45 m single linkage) with the arriving
  directions that have a left-turn lane (`turn:lanes*` with `left`); every
  stop / give_way sign with the junction it controls (walked along its way,
  honouring `direction`) and the arriving direction, `stop=all`; roundabout
  rings (junction=roundabout ways joined), mini roundabouts; marked crossings
  (ladder/zebra bars vs two lines, `dots` = elephant's feet). `prepJunctions`
  (main.js, after prepHighways; ~60 ms desktop) matches them to graph nodes:
  `jc.ctl[node]` -> a controller: **SIG** (its nodes -- a divided road's
  crossing is 2-4 -- approaches from outside them, two phase groups by axis,
  a cycle: advance left arrows (dual lead, `T_ADV` 7 s + 2 s clearance) where
  OSM maps a left lane, green 14-26 s by class, amber 3-4.2 s by speed,
  all-red 2 s; offset by position; a one-group signal gets a 12 s ped phase),
  **STOP** (signed approaches; all-way if `stop=all` or every approach is
  signed), **RB** (a ring entry; the ring is the graph's own one-way edges,
  ordered by flow -- 57 graph gaps of a few metres in the rings are bridged),
  **MINI** (all-way yield). Stop lines (`A.back`) and the signal hardware are
  worked out lazily (they need `city.junction`'s shapes). ~484 signals, ~4.6k
  two-way stops, ~255 all-way, 108 roundabouts / 364 entries, 6.3k crossings.
  - **AI** (traffic.js `junctionStop`, gated on `traffic.jc`, not for police
    units): the next controlled junction on the route answers `jc.decide`:
    red -> stop at the line; amber -> stop if it takes < 3.2 m/s^2, else go;
    a permissive left yields to oncoming cars whose ROUTE passes the
    junction (`routeTo`); stop sign -> a full stop at the line (< 0.35 m/s
    within 2.2 m), then all-way first-come-first-served (`C.q`, ties by prio,
    a 9 s patience) with the box clear, or two-way: no car whose route
    reaches the node within `GAP_T` 6 s; roundabout entry -> yield to a ring
    car that reaches the entry within `RB_GAP` 3.2 s (or is at it) unless its
    route leaves the ring first. Going on commits (`v.jcGo`) until that
    approach is behind it. **A held car creeps to its line** (`jStop`): the
    normal stopAt braking ends wherever the speed runs out, metres short of
    a stop line, and never counted as stopped (cars sat there 100 s). Held
    cars accrue `restT` at 1/5 rate; cross-traffic prediction ignores cars
    braking for their own control (`ctlHold`). City spawns now skip a spot
    within 15 m of a car and spawn no faster than the queue ahead allows.
  - **Drawn** (all into the chunk's flat mesh, `meshChunk`, no draws):
    stop bars (0.45 m, behind a crosswalk on the arm), crosswalks moved out
    of the junction polygon to just past the arm's mouth (`xingS`; two on one
    arm drawn once), elephant's feet, shark's teeth at yields and ring
    entries, the mini roundabout's white dome, ring lane lines (OSM `lanes`),
    galvanised poles on each approach's far-right corner with a mast arm over
    its lanes and a footing, STOP (block letters) with the red-on-white
    ALL-WAY tab, YIELD (Canada's blank triangle), the roundabout island
    (kerb, domed lawn, a mulch bed of ornamental grasses, junipers and
    boulders, young spruce on big ones), a black chevron board facing each
    entry, splitter islands down two-way approaches. The ring edges' inner
    pavement is the **truck apron** (world.js meshRoad tints that side's
    pavers red: `jc.apronSide`). Rural chains' own stop sign defers to OSM's.
    The old static signal props on arterials are off when `city.jc` exists.
  - **Heads** (`SignalHeads`, main.js draw()): within 330 m (230 phone) of
    the camera, rebuilt every 0.4 s: ONE InstancedMesh of housings (a unit
    section scaled by the lens count: black, black backplate, yellow
    retroreflective border) and ONE of lenses (unlit, a 4-cell canvas atlas:
    ball, left arrow, hand, walker; `aCell` per instance; visor in the same
    geometry). Kinds: 3-section, 4-section (the green arrow under the ball,
    on approaches with an advance), pedestrian (walker for the first 55 % of
    its group's green, flashing hand, hand). Red + green arrow in the
    advance (Ontario dual lead lefts). Flashing green: not used.
  - **Verify:** `VIEWS=tools/kw/junctionviews.json node tools/kw/kwshots.mjs
    <dir>` (signals, heads close up, roundabouts, stops); the fuzz probe
    `VIEW_PROBE_FILE=tools/kw/jcttraffic.js node tools/kw/kwshots.mjs /tmp/x`
    (fixed dt 1/60, paused game, 8 sites x (20 + 180) s of city traffic;
    `window.__jct` in VIEW_BOOT_JS for others). Base (v35) -> this: AI-AI
    overlaps 27 -> 8, crashes 0 -> 0, stuck > 60 s 0 -> 0, recycled 10 -> 5,
    island intrusions 0, mean speed near the sites 31 -> 22 km/h (they wait
    now); commits: 391 on green, 20 on amber, 3 on red (over the line as it
    turned), 15 permissive lefts, 296 stop-sign departures after a full stop
    (4 without: spawned past the line), 73 roundabout entries, 0 into a busy
    ring; ~6000 s held at reds, 204 s yielding at entries. Phone (AUTO_PHONE=1,
    GPU), base -> this: spawn 205 -> 207 draws, 998k -> 1029k tris; Uptown
    signal 310 -> 312; a signalled arterial 103 -> 105, 665k -> 674k; its
    aerial 189 -> 191; roundabout entry 163 -> 165; roundabout aerial 248 ->
    247; all-way 449 -> 449, 1228k -> 1249k; stop 457 -> 459. 0 exceptions.
  - **Right turn on red, walk signals** (QA pass after v39): a car whose
    move is 'R' at a red stops at the line (< 0.35 m/s within 2.2 m,
    `v.jcRtor`), waits 1.2 s, then goes if `rtorBusy` is clear: nothing
    moving in the box, nobody on foot crossing within the box + 9 m
    (traffic's `crossXZ`), and no car on an approach whose group has the
    light (green, amber, advance) reaching the line within `GAP_T` or
    standing within 12 m of it. `A.noRtor` (unset: OSM's no-right-on-red
    signs are not extracted) forbids it. `T.stats.rtor` counts them; the
    fuzz probe's `commits.rtor`. **Pedestrians at a signalled corner**
    (peds.js, the crossing wait): `jc.walkState(C, jc.walkGroup(C, dx, dz))`
    -- the same answer the pedestrian heads show (`walkState`; a one-group
    signal's ped phase walks ACROSS the road) -- they wait on the hand and the
    flashing hand, step off on the walking person (still giving a moving car
    2.5 s), and the wait does not count against the path's time. Verify with
    `VIEW_PROBE_FILE=tools/kw/pedsignal.js node tools/kw/kwshots.mjs /tmp/x`
    (steps traffic + peds at four signals and classifies every step off the
    kerb from the phase alone, so it runs on master): master 9 walk / 8
    flash / 23 hand, this 35 / 1 / 4 (the 4: a corner the probe attributes to
    a neighbouring signal); mean kerb wait 0.7 -> 13.7 s.
  - **Signal poles stand on the kerb corner** (`rigs`, `POLE_SEARCH`): the
    nearest spot off every carriageway and out of buildings, searched out to
    the right and along the road. The old six diagonal steps gave up in the
    road for 95 of 1701 poles (12 now); a pole in the lanes is a collision
    obstacle, cars wedged on it, backed out and hit the car behind -- the
    "all-way" hotspot at (-316, 428) was signal 560's two poles in its lanes:
    master 4 crashes in 2 x 600 s of traffic there, 0 after. Mast arms run
    to `MAST_MAX` 17 m and a lane head past the arm's end is dropped (it hung
    from nothing). Stop/yield sign posts search the same way
    (`SIGN_SEARCH`) or are not planted. `tools/kw/roadclutter.js` counts
    collision obstacles standing on a carriageway round 12 sites: master
    19, this 2. A two-way stop also waits for a car standing on the major
    road within 12 m of the junction (it pulls away the moment it can).
  - **Not done / approximate:** signal timing is fixed-time (no detectors);
    no-right-on-red signs are not read from OSM;
    approaches the matcher misses (52 signal clusters, 171 stops) stay
    uncontrolled; 2 stop lines of ~8.3k still lie across another street
    wherever they go and are not painted ("Follow-ups after v55" below); a
    two-way stop's side street can wait long on a busy arterial.
- **The University of Waterloo** (src/uwcampus.js, `data/uw.json` from
  tools/kw/build_uw.py; docs/uw-*.jpg). build_uw.py takes every campus
  building from OSM (inside Ring Road, or a named university / college /
  dormitory / chapel / sports building in the box round it, or a V1/REV
  block tagged building:colour #AE9183) with its levels / height / min_level
  and its **building:part masses** (each part goes to the building its
  centroid is in), the enclosed bridges, Ring Road and the campus's POI
  nodes (the letters sculpture, the Plant Operations stack, the artworks).
  `prepCampus` (after prepPlaces) flattens those buildings' boxes (`kw.skip`,
  `kw.uw`) but leaves them a `kw.poly` of the real outline, so kw.js's
  nameplates still find the street face. `buildCampus` draws each building
  from its parts when they cover >= 70 % of the outline (else the outline +
  the parts that rise above it or float), storey 3.95 m, in ITS look:
  `BY` (by OSM ref) / `BY_NAME` / `PART_STY` (by part id) pick a style --
  wall colour and a window treatment ('ribbon', 'slit', 'punch', 'hood',
  'curtain', 'facet', 'stripe', 'hex', 'fins', 'arcade', 'none'). Colours
  from photos (Commons, Oct 2026): the 1958-62 core (PHY, C2, ESC, B1/B2,
  E2/E3, DWE, CPH) buff/tan brick; MC, NH, PAS pale precast; Dana Porter a
  cream ribbed tower of staggered slits on a dark glass neck, a podium of
  fins under a brown fascia, a ground floor of piers, a brown mechanical cap
  and mast; Hagey Hall / SCH / the Arts dark brown brick; M3 orange-red
  brick + teal glass; E5 white and E7 (the PEARL SULLIVAN ENGINEERING
  BUILDING since Nov 2025 -- OSM's PSE) grey diamond-faceted panels with
  glass bands, E6 dark panels; QNC's barcode stripes and the honeycomb wing;
  DC tan wings, the teal glass barrel vault (OSM: roof:shape round) with
  grey-green gooseneck ducts and red portals; EV3 grey with lime bands; V1 /
  REV / MKV / the colleges red-brown brick, Grebel's stone chapel. `SIGS`
  adds per-building signatures (DC, DP, Physics' dome, E5's penthouse, SCH's
  chimney, Grebel's chapel gable, DC's bridge on red legs). **The E5 Bridge**
  (OSM's 81 m corridor line) is a one-storey dark-blue glass tube with a
  silver mullion grid, 6.8 m over the highest ground under it, on round
  concrete columns kept off the carriageway, and no street tree under it
  (`clearAt`); other enclosed bridges OSM draws only as lines get a glazed
  link at the second floor, REV's a covered walkway on posts. Also: the
  UNIVERSITY OF WATERLOO steel letters on their plinth, WATERLOO
  ENGINEERING letters at E7, the gate signs (black, the gold shield) at
  Ring Rd / University Ave, the boulder ring and five flagpoles in front of
  SCH, the stack, Triad, the Obelisk, the Porcellino. **Draws:** the shell
  is drawn in kw.js's `polyMat()` into buildPolys' `kwp` clusters (no draw
  of its own; builders retire at 50k vertices so the merge keeps them);
  detail (mullions, hoods, fins, sills, sculptures, lettering) goes to
  `near:` clusters that landmarks.js hides past 520 m (updateLandmarkRange,
  the beaches' rule). `window.__noCampus = true` before boot (kwshots
  `VIEW_BOOT_JS`) for a before/after; `window.__uwCampus` has the counts
  (~150k tris, ~85k of them near-only). Phone (AUTO_PHONE=1, GPU), before
  -> after: from Uptown looking toward campus 225 -> 224 draws, 957k ->
  958k tris; over the campus 160 -> 164, 639k -> 727k; under the E5
  bridge 156 -> 159, 658k -> 741k; at Dana Porter 178 -> 182, 563k -> 650k. Verify with `VIEWS=<file> node tools/kw/kwshots.mjs`,
  e.g. on Ring Road under the bridge (c -5318,-2262 -> t -5272,-2228).
  Approximate: DC's vault is a box-fitted barrel; the colours of C2/ESC/
  B1/B2, AL, EV1, RCH and STC were not confirmed by photos.
- **The generic city's look** (docs/look-*.jpg, before over after; judged
  against Esri World Imagery and street views of Beechwood, Cherry Park,
  Victoria Park, Northfield, Sunview, Hespeler). **The class comes from OSM's
  landuse now:** 124k of the 190k footprints are bare `building=yes`, which
  used to fall to "house" and then, over 260 m2, to a 'brick' box -- and
  kw.js markStrips made every such box under 7.5 m a STRIP PLAZA, so two
  thirds of Beechwood's double-garage houses were one-storey stores with
  white flat roofs. `tools/kw/extract_looks.py` (one quick pass of
  kw.osm.pbf -> `raw_looks.json`: landuse residential/commercial/retail/
  industrial polygons, and roof:shape / building:material / building:colour
  per building, keyed by the ring's first point) feeds build_buildings.py:
  an untagged building in a residential zone is a house up to 460 m2 (a
  long one up to 1600 m2 a townhouse row), else a 9.5 m walk-up (cls 1); in a
  commercial/retail zone cls 2, industrial cls 3; outside every zone over
  460 m2 it is **cls 5** (the old size rule in citygen styleFor); barns and
  farm buildings are cls 3. **The class byte is packed:** low 3 bits class,
  bits 3-4 the mapped roof (1 flat, 2 gable, 3 hip), bits 5-7 the wall
  (1 red brick, 2 buff, 3 grey stone/block, 4 siding, 5 concrete/stucco,
  6 metal, 7 glass); citygen unpacks it to `bd.look` (+32 when OSM says
  apartments) and the building cache carries it. **world.js:** houses are
  Ontario's -- 68 % brick (`HOUSE_BRICK`, on the new `brickhouse` atlas cell,
  textures.js: the house elevation in a running bond, soldier courses and
  sills; it is the LAST cell so facadeMat's masonry/brick indices hold) and
  vinyl siding in beige/grey/white (`HOUSE_PAINT`); asphalt shingle roofs in
  charcoal, grey and brown (`HOUSE_ROOF`); gables and hips about evenly, a
  flat roof on ~2 % (Seattle's 11 % made every street a new build);
  `houseWall` takes OSM's material first. Detached houses 9.5-24 m wide get
  the garage door IN the footprint on the street face (a double on wide
  ones) and a driveway to the kerb. Industrial walls are tilt-up beige/grey
  and steel in white/blue-grey/tan (`INDUSTRIAL_WALL`), big flat roofs light
  three times in four. `buildingFamily`: OSM's material first, then KW
  weights (brick and precast low, white/grey precast high; apartment towers
  over 30 m their own mix), and apartments get balconies on most (brick ones
  included). **Overhead hydro** (`hydroEdge`, `hydroLine`): every arterial,
  and the side streets of the old cores (`OLD_CORES`: downtown Kitchener,
  Uptown, Bridgeport, Galt, Preston, Hespeler, St. Jacobs -- radii are a
  judgement, not data); poles every 40 m on one side per street name (wood,
  or spun concrete on some arterials), crossarm, three primaries + a lower
  line, a transformer on one in five, the street light on a davit (the
  street's own lamps are dropped). Poles sit on a lattice along the
  street's direction so OSM's short edges join up; a span is strung only to
  a pole that exists (`cityStats.hydro`). Phone (AUTO_PHONE=1, GPU), v28
  -> this, draws/tris: spawn 207/935k -> 204/975k; Beechwood aerial
  323/1379k -> 320/1454k, low 374/1188k -> 371/1229k; Sunview low 213/667k
  -> 213/716k; Northfield low 129/643k -> 132/685k (max +7.3 % tris, draws
  flat). Re-run order after an OSM update:
  `extract_looks.py` then `build_buildings.py`.
- **The radio (src/audio.js `STATIONS`, `_makeLive`..`_watchLive`;
  `node tools/kw/radiotest.mjs`).** Every station is LISTENED TO, not just
  loaded: an earlier check only saw `currentTime` advance, and a stream that
  loops "this stream is not available", or silence, or zeros through Web
  Audio passes that. **Test from where the radio is played (Seattle):**
  Canadian commercial streams -- Rogers' leanstream (CHYM, Country 106.7, 570
  News, HLS and ICY alike), CJIQ's leanstream, Indie88 (streamb SB00348),
  Stingray's Boom 97.3 -- answer 200 with audio and CORS, and the audio is
  "The stream you are trying to access is not available at this time" /
  "only available within Canada" on a loop. Corus `live.leanstream.co` is
  not even audio. They were replaced by campus, community and public
  stations that play here. CBC is its own HLS (`cbcradiolive.akamaized.net`,
  the `adaptive_128/chunklist_ao.m3u8` MEDIA playlist: Chrome 155 plays HLS
  media playlists but cannot parse CBC's master; K-W is `2040995/ES_R1EKW`,
  the whole list is in https://www.cbc.ca/listen/live-radio's page source);
  streamtheworld's MP3s close after 32 KB for any browser user agent.
  **Two routes** (`_route`): every stream plays through a `crossOrigin`
  element -> `createMediaElementSource` -> `radioGain` (= `stationNorm`, the
  stream's measured `lufs` brought to `RADIO_REF` -14, +-12 dB) ->
  `musicDuck`, so it is levelled, ducked and under the master volume on iOS
  too (which ignores an element's `volume`). A station whose 'wa' load fails
  (no CORS: `error 4`, a CORS header on a redirect missing, or sent twice --
  AH.FM's fr. relay sends `*, *`), or whose media source gives exact zeros for
  4 s while the element's clock runs (`_watchLive`; WebKit has done this for
  HLS), moves to the plain `direct` element for the session (`_direct`), its
  `volume` = `DIRECT_LEVEL` x norm where honoured. Then two reloads, then the
  synth covers until a retune. **`stalled` is NOT a failure**: it fires every
  few seconds on healthy HLS, and treating it as one threw BBC Radio 1 to the
  synth while the stream played on under it; a clock stopped 15 s is.
  `primeLive` unlocks BOTH elements in the gesture (WebKit unlocks media
  elements one at a time). **The synth radio was 25 dB under the streams**
  (musicBus 0.2: -42 to -44 dBFS RMS) -- the two synth stations and every
  fallback were "just quiet"; `SYNTH_LEVEL` 3.2 puts it at -18 to -20.
  radiotest: per station HTTP status and CORS as polkiewicz.com sees them;
  ~50 s through ffmpeg (`tools/kw/radioprobe.py`: EBU R128 LUFS, % silent,
  a loop score, and a faster-whisper transcript checked for "not
  available" -- `RADIO_PY=<python with numpy + faster-whisper>`); then the
  game in headless Chrome, in a car, `setStation(i)`, 8 s of RMS off an
  analyser on `musicDuck` scaled by pre x master (= dBFS at the speakers).
  Re-measure and update a station's `lufs` when the test notes a drift > 4 dB.
  Last run (2026-10-20, from Seattle; `out` is game output RMS, dBFS):

  | # | station | LUFS (set) | silent | transcript (start / end) | route | gain | out |
  |---|---|---|---|---|---|---|---|
  | 0 | Radio Waterloo 102.7 | -21.1 (-18.8) | 3.4% | "...the spiritual in the natural..." | wa | 1.74 | -18.9 |
  | 1 | CKWR 98.5 Community | -12.2 (-12.8) | 0.8% | "Cup Champions. The time for you to be a champion..." | wa | 0.87 | -18.1 |
  | 2 | CBC Radio One K-W 89.1 | -21.4 (-21) | 1.4% | "biodiversity loss in the UK..." | wa | 2.24 | -17.1 |
  | 3 | The Grand 101 Fergus-Elora | -12.9 (-13) | 0% | "Back with more of Centre Wellington's best music" | wa | 0.89 | -17.0 |
  | 4 | CFRU 93.3 Guelph | -14.8 (-16.8) | 0% | "I can't hide my feelings..." | wa | 1.38 | -15.8 |
  | 5 | CKRZ 100.3 Voice of the Grand | -17.8 (-18.3) | 0% | "How important is the..." | wa | 1.64 | -15.8 |
  | 6 | Vibe 105.5 York U | -13.9 (-14.7) | 0% | (lyrics) | wa | 1.08 | -15.1 |
  | 7 | CIUT 89.5 U of T | -22.2 (-17, now -18.5) | 0.2% | "Everybody needs cash to spend..." | wa | 1.41 | -23.7 |
  | 8 | JAZZ.FM91 | -22.9 (-24.5) | 0% | (instrumental) | wa | 3.35 | -16.4 |
  | 9 | The New Classical 96.3 | -17.5 (-17.2) | 0% | (instrumental) | wa | 1.45 | -17.2 |
  | 10 | CBC Music | -19.7 (-19.2) | 0% | "It's the world, yeah..." | wa | 1.82 | -16.0 |
  | 11 | RdMix Classic Rock | -17.8 (-18.4) | 0% | (lyrics) | wa | 1.66 | -15.8 |
  | 12 | NRJ Linkin Park | -15.9 (-15.6) | 0% | (lyrics) | wa | 1.20 | -16.4 |
  | 13 | BBC Radio 1 | -17.3 (-17.5) | 0% | (lyrics) | wa | 1.50 | -15.7 |
  | 14 | AH.FM Trance | -12.8 (-12.7) | 0% | (lyrics) | wa | 0.86 | -16.6 |
  | 15 | Grand River FM | synth | - | - | synth | 3.2 | -19.8 |
  | 16 | King St Radio | synth | - | - | synth | 3.2 | -18.2 |

  All 200 with CORS ok, none looping or "not available", 0 exceptions.
  Not covered headlessly: the iPhone. If a station is silent there, the
  Debug readout's audio log says which route it took and why it moved.

- **The country roads: src/rural.js** (docs/rural-gravel*.jpg,
  rural-regional*.jpg: master before, this after, from the driver's seat).
  **Rural is decided from the data** in citygen (step 2e, after the
  buildings, before anything reads a pavement width): every gravel road
  (gravel.js, tagged there now, not in main.js), and any other ground-level
  res/st/art street whose 300 m window has < 3.5 building centres within
  60 m, < 5 % built cover (citygen's `built`, the measure groundTint paints
  fields by) and < 260 m of OTHER streets within 110 m (a subdivision with
  no houses mapped is still a net of streets); runs under 160 m flip to
  their neighbours. ~865 km, 1640 chains (`cityStats.rural`). **A rural
  edge has no pavement or kerb: `walkWidthOf(e)` (citygen) is 0** -- every
  sidewalk-width site goes through it (citygen's grading, cuts, junction
  corners, liftGrid; world's meshRoad, trench walls, legacy nodes, portal
  cuts). **Chains** run through PASS-THROUGH nodes (`n.rpass`: two rural
  edges < 35 deg apart, OSM's ~50 m splits): no junction polygon there
  (buildJunction null, meshNode returns), the strips are MITRED
  (`world.ruralMitre`), paint is not trimmed, and the raise and the hydro
  line run on by chain position `c = e.rs0 + e.rsd * s`.
  **Cross-section** (`ditchLift`): the carriageway RAISED `RAISE` 0.42 m
  over ROAD_LIFT (the terrain mesh is 40 m, so a ditch cannot be dug into
  it -- the road and the field edge stand up round it instead), 0 at each
  end junction past its mouth + MOUTH_RAMP, full RAMP 22 m on; gravel
  shoulder SH 1.3, foreslope FS 1.7 to the bottom at BOT, bottom DB 0.9,
  backslope BS 1.3 to the BERM 0.45, fade FD 2.4 to the ground (RW 7.6).
  Crossings (`C.xing`: one farm lane per cluster of buildings within 150 m,
  field entrances by hash, and paths/golf/kartway from `city.extraClear`,
  lazily) fill the ditch level with the shoulder (`ruralLift`). **ONE
  function, two consumers:** citygen.roadLift's rural branch (`ruralSide`,
  `ruralRaise`, the gravel CROWN 7 cm) and world.meshDitch (bands of quads
  whose vertex heights ARE `ruralSide`) -- so what is driven/walked is what
  is drawn: `tools/kw/ruralprobe.js` (VIEW_PROBE_FILE) raycasts across
  rural roads at five sites: carriageway 98.6 %, shoulder 99.2 %, ditch
  98.9 %, berm 97.4 % within 4 cm, and rides chains for kinks (< 5.5 cm per
  0.5 m^2). Two traps it caught: a round cap past an end measured from the
  node and read the next strip's ditch as a berm (caps skipped off the
  carriageway), and a cap on the carriageway held the end's raise flat
  (past a pass-through end it takes the chain's raise there).
  **Drawn** in the near chunk's road mesh (no draws): `surf` per vertex
  (`SURF_GRASS`, `gravelSurf`, `surfMark`) puts the road material
  (roadWalkMat) into a GRAVEL mode (the asphalt grain seen three times,
  windrows on the crown and edges, two packed wheel tracks a lane, no
  gloss) or a GRASS mode (vertex colour = albedo; straw slopes, a dark wet
  bottom, the field's own tint at the toe). Farm lanes run to the house
  (`meshLane`), culvert ends show in the fill (`meshCulvert`), a mailbox
  and a green civic-number blade (Wellington County's style, which Woolwich
  follows) at each farm lane. **meshRuralProps** (instead of the city's
  kerb furniture): a wooden hydro line every 46 m on one side per chain,
  on the berm (crossarm, three primaries, the lower phone line, wires
  sagging; a transformer near some farms) -- the city's `hydroLine` no
  longer strings a span into a rural edge; page-wire fences on T-posts or
  cedar snake-rail at the field edge in 150 m runs; yellow-diamond horse
  & buggy signs every ~1.3 km in `mennoniteCountry` (shared with buggy.js),
  curve warnings 95 m before a bend > 24 deg, stop signs where the chain
  meets a bigger road (half the even crossings). Poles, posts, signs and
  mailboxes are solid and knock down (`_fell`). **Who else had to learn
  it:** peds never spawn, plan into or re-anchor on a rural edge (fares
  and walking cops neither); no kerbside parking (traffic.kerbSlots);
  buggies drive only rural edges, half on the shoulder (gravel: hw - 1.0);
  street trees give way to sparse fencerow trees past the ditch; crops,
  forest trees and house driveway stubs keep out of `city.ruralClear`
  (ditch zone and lanes); AI lanes are unchanged (0.48 hw). Dust: anything
  over 6 m/s on gravel (you, and up to 8 cars within 200 m) trails a
  limestone plume (main.js). Phone (AUTO_PHONE=1, GPU), master v31 -> this:
  spawn 205/980k = ; Kressler Rd 86/513k -> 86/514k; Lobsinger Line
  228/749k -> 227/765k; a gravel concession road 63/372k -> 60/369k.
  Road-name blades at rural junctions: see "Street-name signs" (their own
  atlas). **Not done:** the outside wedge of a bend at a pass-through
  node reads ground in roadLift (mesh mitred: < 10 cm on gentle bends).
- **The generic look, round two** (docs/look2-*.jpg, before over after).
  **Striped plaza roofs:** world.js `_stripMall`'s roof sat at exactly
  `bd.y + bd.h`, coplanar with `buildSkyline`'s always-drawn far box (every
  footprint over 1400 m2 or 16 m), and the two z-fought in tan/white bands.
  The strip's box has no top now; its white/pale-grey lid sits inside the
  parapet, 0.16 m over the skyline's, as meshBuilding's lid always did.
  **Any near roof at exactly `bd.y + bd.h` on a skyline-sized box is this
  bug again.** The same class across drawers: `kw.dedupeFootprints` (main.js,
  after every module's prep) finds every pair of drawn footprints
  (world.js box, strip, kw.js poly, kwshops shop) that overlap with roofs
  within 1 m: the plainer drawer goes flat (kw.skip) when 70 % of it is
  inside the other, else the smaller roof is lifted 0.6 m; a house box
  inside a store 8x its size goes flat at any height (St. Jacobs Outlets).
  `window.__kwDedupe` has the counts (~170 pairs, ~50 flat, ~90 ms
  desktop); `VIEW_PROBE_FILE=tools/kw/doubleprobe.js node tools/kw/kwshots.mjs x`
  lists every overlapping pair by drawer, SAME-ROOF (< 0.4 m apart: a
  z-fight) or step -- 247 overlaps before, 0-1 SAME-ROOF after.
  **The new towers** (world.js `modernTower` / `towerLook` / `_towerPanels`):
  an apartment (OSM apartments, or a name with Condos/Tower/House/Residence)
  of 24 m+ inside `MODERN_ZONES` (the UW/Laurier student district box and
  downtown Kitchener) with no OSM material takes white or light-grey precast,
  window wall (white slab edge every floor) or charcoal panel, full-height
  stacks of a second panel colour at the corners, and on half a stack of
  accent panels (orange, lime, red, blue, yellow) down the street face and
  its back; `TOWER_NAMED` pins Sage, ICON, Luxe, One Victoria, Charlie West,
  Duke Tower, Young. **Car parks:** build_lots.py bakes retail/commercial
  landuse >= 3000 m2 as striped parking in the polygon's orientation, with a
  4.5 m concrete storefront ring round each building in it (`LU_PARKING`;
  12.5 -> 17.5 km2 striped); world.js `lotLights` puts, in lots that carry on
  20 m round the spot, a kerbed island (one bay, across both rows of a seam)
  with a 9 m light standard (two LED heads, glowing at night) every 13 bays
  on every other seam of the shader's bay grid, and a young tree on 60 %
  (trees.js reads `world._lotIslands`); traffic.updateLotParked leaves those
  bays empty; poles and islands are obstacles. Cart corrals stay kwshops'.
  **Yards:** `_yardFence` -- cedar privacy fences round 3 back yards in 4
  from the occupancy raster (back line halfway to the house behind, drawn
  by the lower seed; right side only, so a row has one fence per pair;
  gate runs across both side yards), 16 tris a yard, not solid;
  `cityStats.fences`. `_drivewayKit`: green bin + blue box (+ grey cart)
  at the end of one driveway in four, a portable net on one in nine.
  **Palette:** SUBURB a touch greener (KW lawns stay green in October); the
  sky was left alone. Phone (AUTO_PHONE=1, GPU), v29 -> this, draws/tris:
  spawn 206/979k -> 205/997k; Beechwood aerial 364/1284k -> 363/1308k;
  street 326/1132k -> 326/1152k; student towers 181/761k -> 181/777k; plaza
  lot aerial 348/1119k -> 348/1141k, low 449/935k -> 451/974k (+4.2 %, the
  most); St. Jacobs 75/304k -> 75/308k.
  **Round two** (docs/uw-davis-vault.jpg, uw-pinktie.jpg): DC's vault is
  fitted to OSM's outline (`vault`: slices every ~3 m along the part's long
  axis, each as wide as `spanAt` finds the outline there) with DC's own
  section, a ~3.4 m rounded eave into a shallow crown (~5 m over the walls,
  not a 9 m Quonset); the ducts follow it. The PAC in SCH's language (dark
  brown brick, pilasters `pil`, a deep white precast `fascia`; its <= 2-storey
  parts take `low`); the CIF cream brick with a `clere`story under a white
  metal fascia and red steel walkways on its road faces; the SLC brown brick,
  its curved east parts (OSM 1027588307 / 951370624) the Great Hall's blue
  glass, 1027588308 the glass link to MC; B1/B2/ESC white precast with deep
  window frames (`STY.bio`, Commons "BIO Connection"); STC buff brick and
  teal glass. THE PINK TIE: ~12 m of pink tie down the MC stair tower face
  with the most open ground in front of it (`SIGS.MC`, `__uwCampus.tie`).
  The north gate sign stands on the corner where North Campus Road meets
  Columbia St (`junction` + `cornerSpot`; `__uwCampus.gates[1]`). **Open
  lawns:** `campusKeepClear` (city.treeClear, read by trees.js only -- not
  jumpClear, which would also clear kerb props and parked cars): no tree
  within 10 m of a campus facade (UW or Laurier), 60 % fewer to 24 m, 80 %
  fewer on Ring Road's verges, none on Laurier's fields.
  Still approximate: C2, AL, EV1, RCH and GSC colours are unconfirmed (no
  usable photos on Commons); the PAC's look is inferred from SCH, not a photo.
- **Wilfrid Laurier University** (uwcampus.js again; uw.json `wlu` from
  build_uw.py `laurier()`; docs/wlu-stadium.jpg, wlu-sign.jpg). Every
  building inside OSM's campus outline (way 226405688) or operated by Laurier
  in the box round it, with its parts, goes through the same prepCampus /
  drawBuilding (`r.campus === 'wlu'`, styled by name in `WLU`). From Commons
  photos: Bricker Academic, the Science Building, the Science Research
  Building and Alvin Woods red brick banded in cream (`'banded'`: a precast
  band under every row of windows), Bricker's dark-glass stair tower and the
  Science Building's octagonal tower with its grey cap at the west end
  (SIGS); Lazaridis Hall a box of blue-grey glass on a dark frame; the
  library, Arts wings, FNCC, Peters, John Aird, the residences; the solarium
  a hipped glass roof (`glassRoof`; OSM's "Solarium" -- the Concourse itself
  isn't a separate OSM building, so it is not drawn apart); Martin Luther's
  limestone and its two-pier bell tower. Fields (`laurier`): Alumni Field and
  Knight-Newbrough Field as Canadian football fields (`gridiron`: 150 x 65 yd
  scaled to fit the pitch, turf tiled on the terrain, 5-yd lines, goal posts
  on the goal lines; the stadium's end zones purple, the golden hawk at
  centre field on the atlas), the track (`trackRing`, 2.5 m cells), the
  grandstand from OSM's footprint (rows, purple seats, press box; OSM's
  Stadium Building is the space under it and is not drawn), a LAURIER GOLDEN
  HAWKS scoreboard, light masts at Alumni Field, and the LAURIER signs
  (white, purple maple leaf, WILFRID LAURIER UNIVERSITY on dark stone) on the
  campus corners of King/University and University/Hazel. Phone (AUTO_PHONE=1,
  GPU), master -> this: spawn 202 -> 204 draws, 915k -> 924k tris; over UW
  189 -> 191, 794k -> 829k; DC on Ring Road 305 -> 306, 1067k -> 1095k; at the
  King/University sign 360 -> 363, 1260k -> 1296k; over Laurier 198 -> 203,
  748k -> 790k; the stadium 176 -> 179, 717k -> 749k (those cameras, and the
  gate / tie / vault / Science Building ones, are `VIEWS=tools/kw/campusviews.json`). `__uwCampus.wluSigns`
  has the signs. Approximate: the hawk and scoreboard wording are generic,
  not traced; the track's curved edge is stepped at 2.5 m.
- **KW fun things: the Aud, Oktoberfest, Big Splash** (docs/fun-*.jpg;
  `node tools/kw/funprobe.mjs <dir> [aud,fest,parade,splash]` plays each end
  to end through real CDP key and mouse input and checks build-on-entry /
  free-on-exit, holds and exceptions). **The probe waits on game state, never
  on wall clock** (a held W is released by the player's real distance to the
  next landing; the ride is checked by distance down the flume): under
  SwiftShader (no AUTO_GPU, ~5 fps, dt clamped) game time runs at a third of
  real time, and the first version's timed holds stopped on the ground and
  checked the ride 0.7 m in. `FUN_THROTTLE=4` slows the CPU to prove it.
  **Interiors are their own
  THREE.Scene**, built on entry, rendered by the game's renderer while the
  city draws NOTHING (main.js `interiorUp()` returns before draw in the
  paused branch), every geometry/material/texture disposed on exit;
  `interior.js setInterior` hides the game's HUD under them.
  - **The Rangers at the Aud** (src/audrink.js; hockey.js `view3d`): the
    same hockeygame.js sim drawn in the Aud's bowl -- 22 steep rows (0.58 m
    rise / 0.85 m row) right round the ice, ~7,000 instanced fans (one draw,
    a shader bob that jumps on a goal; 4,150 on a phone), the barrel roof on
    arch ribs, centre-hung clock (canvas, redrawn on change), board ads, and
    the banners over the far stands: OHL champions 1981, 1982, 2003, 2008,
    Memorial Cups 1982 and 2003, and #1 for the fans (Stadium Journey /
    the OHL arena guide; an unconfirmed 2026 Memorial Cup is NOT hung). A
    broadcast camera high in the near stands leads the puck; the intro walks
    in through a portal. The 2D canvas carries only the HUD. Short game:
    3 x 1:20 (`periodS`); the visitors alternate London Knights (green) and
    Guelph Storm in road whites (crimson/black; hockeygame.js `RIVALS`,
    `setRival`). `hockey.speed` steps the sim faster for harnesses. Inside,
    phone: 36 draws, ~91k tris (desktop 34 / 139k), built in ~10 ms.
  - **Oktoberfest** (src/oktoberfest.js): festhallen at Concordia Club,
    Bingemans' Marshall Hall and the Schwaben Club (kw.json named buildings;
    the door is marched out of the box toward the nearest street). ENTER
    walks you in (camera down the aisle, onto the stage): long tables, a
    seated crowd swaying (schunkeln, a shader), the band, Onkel Hans
    (`onkelHans()`), bunting, banners; one label atlas. MASSKRUGSTEMMEN on the
    stage: left/right (A/D, drag) against a wobble that grows (`_stepContest`:
    three sines x (18 + t) deg/s^2, kicks, an unstable lean), Up (W/Space,
    drag up) against a sag that outgrows the lift by ~53 s; out at 24 deg or
    1 s under the judge's line. Four rivals drop out at drawn times (last one
    40-70 s); $20 a rival beaten, +$100 to win; best in `autokw-stein`.
    Phone inside: 14 draws, 22k tris. **The parade** (`Parade`): the real
    route -- Weber St from Frederick St toward Waterloo (oktoberfest.ca: the
    2025 and 2026 parades ran up Weber to Bridgeport, NOT King St) -- found
    by walking `Weber Street*` edges from the Frederick junction toward the
    spawn, ~1.5 km. ENTER at its marker starts it (`begin()`; `start` is the
    junction's position): Onkel Hans' float, a 16-piece band (instanced,
    stepping), barrel, Miss Oktoberfest, pretzel, Bavarian house, at 1.8 m/s,
    the crowd up to three deep on both kerbs (cheering where the column is:
    per-instance route position `aS` vs `uS0..uS1`). Weber's edges get
    `noTraffic` (no routing, no spawns) and their kerb slots are held in
    `traffic.reservedSlots`; cars on it are removed out of sight. Everything
    is disposed and Weber reopened when the tail passes the end. Phone at
    the kerb: crowd 2,666, ~+66k tris, draws flat (the floats' ~13 draws
    offset by the cars taken off Weber). Music: `Band`, an ORIGINAL oom-pah
    waltz synthesised note by note (no recording; Ein Prosit / the Chicken
    Dance deliberately not used), levelled by distance to the band.
  - **Big Splash** (src/bigsplash.js; kwsights.js `bingemans`,
    `splashRide()`): the tower got stairs -- three quarters of a square
    spiral from the uphill side, every flight a SLOPED city platform and
    every corner a landing (they never overlap in plan: `platformAt` takes
    the highest), a bridge onto the deck (a platform); the solid tower box
    became four post solids. The slides are open flumes now (`trough`, both
    faces), the run-out pools raised basins past each flume's end, and the
    wave pool moved to the uphill side (it used to sit under the green
    slide's run-out). ENTER on the deck rides the slide you face: a
    Catmull-Rom of the flume every 0.25 m, gravity / water friction (0.035)
    / drag, the rider up the outside wall by atan(v^2 k / g), a rider's-eye
    camera (C: one behind), shot into the pool at 55 % speed with a splash
    (points + foam ring), out on foot beside it. ~48 m, ~46 km/h on the
    green one; best top speed in `autokw-splash`. Phone at Bingemans
    90 -> 91 draws, 335k -> 340k tris.
  Phone (AUTO_PHONE=1, GPU), master -> this: spawn 205/998k = 205/998k;
  the Aud from the air 164/883k -> 164/887k. 0 exceptions. Approximate:
  the festhalle is one generic hall for all three clubs (signed with each
  name); the Transylvania Club is not on OSM and not drawn; the parade
  starts on demand, not at 9:30 on Thanksgiving Monday; seats/banners at
  the Aud are not traced from photos; the slides' layout is still
  kwsights' procedural fan, not Big Splash's real plan.
- **Jet skis on Victoria Park's lake** (landmarks.js `MARINAS`;
  docs/jetski-parked.jpg, jetski-ride.jpg). The boathouse marina was already
  there (kayaks and a runabout); its fleet is now kayak, kayak, jet ski, jet
  ski, boat, jet ski (`float` 16): three jet skis moored bow-out along the
  float, each spawned 'apron' by main.js's marina loop like every marina
  craft (never despawned; a ridden one stays where you leave it -- no
  respawn at the float, as in Seattle). Nothing else needed changing: the lake
  is in the wlevel field at 72.50 m, wet and drawn, 1.5-2.2 m deep off the
  float and >= 0.3 m along the crescent's 80 m-wide channel to the
  south-west pond, and the boat physics, the shore stop (`minDepth`) and the
  exit search are all on the LOCAL level. Kept in order: a pair's step along
  the walk is its second craft's (4.5 m a jet ski, 7.5 otherwise), so the
  kayaks go first and the runabout last. Verify:
  `AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/jetskiprobe.js node tools/kw/kwshots.mjs /tmp/x`
  (puts you on the float, ENTER by a real key event, an autopilot on W/A/D
  rides the lake to the far pond and back, 16 waypoints, ~810 m, top ~52
  km/h, then runs onto the north bank and ENTERs off): 0 frames with the hull
  over dry ground, |y - water| <= 0.047 m, it stops at the bank under
  throttle and you step off onto the grass (wl null there), 0 exceptions.
  Phone (AUTO_PHONE=1, GPU, seedrandom), before -> after, draws: on the bank
  238-246 -> 254-258, from the water by the float 268 -> 279-281, the lake
  from the air 190 -> 202-204 (the three more craft, ~4 draws each, within
  their apron show range). Approximate: the lake is the 40 m water field's
  (OSM's outline at that grid), so a jet ski runs where the drawn water is,
  not the real shoreline to the metre.
- **More to do: skating, the Panthers** (docs/fun-skate.jpg, fun-jackcouch.jpg,
  fun-derby.jpg; `node tools/kw/funprobe.mjs <dir> skate,derby` plays both
  through real keys, with the four above still passing).
  - **Skating on Waterloo Public Square's rink** (src/skating.js). The rink's
    look is kwplaces.js's, untouched; it only exports `rinkData()` (outline,
    centre, axis, half sizes, corner radius, ice y). ENTER on the ice laces up
    (main.js tryInteract asks skating FIRST -- its `fishing` guard returns
    early otherwise); `player.skate` hands player.updateFoot's frame to
    `Skating.step`: the stick is where you want to go (camera-relative), the
    body turns at 2.9 rad/s slowing to 1.3 at speed, strides push along the
    way you face (2.3 m/s2, 3.4 with RUN; top 6.2 / 8.8 m/s), the blades turn
    the velocity toward the skates' line (forwards or backwards) at 3.2 rad/s
    with a little scrub, ice friction 0.11 m/s2 + drag (a 3 m glide keeps
    > 97 %); PUNCH (attack; player.attack is skipped on skates) is a hockey
    stop -- body side-on, 7.5 m/s2, snow (`fx.emit`) and a scrape (stops from
    4.5 m/s in 1.5 m); JUMP from < 3.2 m/s a scratch spin (10-13 rad/s winding
    down, ~3 turns, arms hugged, free leg up). The curb is the boards: a
    rounded-rect SDF inset by the body (0.38 m), a rebound and a thunk. The
    pose is `skatePose(h, s)` (absolute bone eulers: crouch, push leg out and
    back, arm swing, lean = v x yaw rate / g as the group's roll), CROUCH
    lowers the body 7 cm. The blades' hiss is looped band-passed noise by
    speed. ENTER again (or a respawn, or leaving) takes them off. Bests
    (`spin`, `kmh`) in `autokw-skate`. **Ambient skaters are the crowd's own
    pedestrians**: `peds.spawnTrail` (within MAX_PEDS, giving up the farthest
    pavement walker) then `p.skate = driver`; peds.js skips steering /
    `_move` / animateWalk for them and calls `driver.drive(p, dt)` and
    `driver.pose(h, p, dt)` (they are not scared, and keep their roll). Each
    has a lane (an n=4 superellipse inset in the rink), pace and phase,
    counter-clockwise, easing behind anyone ahead (you included); one in five
    wobbles. 7 (4 on a phone) while the camera is within 140 m, handed back
    (removed) past 190 m. Always on: the rink is drawn as ice in every season.
  - **Jack Couch Park, the Kitchener Panthers' home** (src/ballpark.js;
    400 East Ave, across the car park from the Aud). OSM has the field as
    leisure=pitch 134225852 (named "Peter Couch Ball Park" there); the frame
    is read off Esri's aerial: home at the field's NW corner (`HOME`), the
    foul lines at 45 deg either side of the bisector of OSM's two far corners,
    the fence along OSM's east / south-east edges (325 / 380 / 325 ft drawn on
    it, computed). Drawn (a kwsights.js extra via `addSights('ballpark')`,
    its Kit and atlas, so no draws of its own; `prepBallpark` flattens the
    building's box): mown outfield arcs, the warning track, the skinned infield
    (the 95 ft arc from the rubber, in rings so it follows the ground; the
    grass square over it; decal lifts 0.04 / 0.09 / 0.13 / 0.17 m -- at 1 cm
    apart they z-fought), the mound, bases, plate, boxes, chalk, on-deck
    circles; the green outfield fence with a gold cap and black/gold panels;
    yellow foul poles; the 60 ft backstop (posts and rails) and low fences
    down the lines; block dugouts (gold roof on third); aluminium bleachers
    down both lines and behind the plate (the long run on first is the
    aerial's); the building behind home (concession, press box glass,
    KITCHENER PANTHERS to the field, JACK COUCH PARK / HOME OF THE KITCHENER
    PANTHERS to the car park), the dedication rock; six 24 m light standards;
    the scoreboard in left-centre. `window.__ballpark` has the stats;
    `window.__noBallpark` before boot turns it off. **The home run derby**
    (`Derby`): ENTER at the gate (`gate()`, map marker 'ball'). The world is
    held ('derby', in reapHolds' live list), the HUD hidden (interior.js
    setInterior), crowd figures within 140 m hidden; the camera sits behind
    the catcher. The BP pitcher (a crowd look) winds up and throws 56-66 mph
    to a random spot; SWING (button, Space / J / Enter, a tap on the canvas)
    starts a 0.18 s swing, and the error against the ball reaching the
    contact plane is everything: |e| > 95 ms misses; exit velocity 48 m/s
    falling off past 15 ms, spray 7.5 rad/s x e (early pulls to left, past
    45 deg is foul), launch 27 deg + the pitch's height + a grounder's
    penalty; flight with drag 0.0062 and backspin lift 0.0028 (/m: ~400 ft at
    105 mph / 28 deg); over the fence's top (2.4 m) a home run, its distance
    the flight carried on to the ground. Twelve swings (takes are free); $25 a
    home run, +$100 for five; best HR / longest in `autokw-derby`. Your own
    humanoid bats (solveArm grips, the bat swept round from -d through +p),
    the bat, ball, trail, pitcher and overlay are built on ENTER and freed on
    LEAVE (draws at the gate 283 before, 280 after in the probe).
  - Phone (AUTO_PHONE=1, GPU), master -> this, draws / tris: spawn 218/1089k
    -> 224/1115k (the skaters come out at once where the crowd fills over
    seconds; they are crowd slots, so a full crowd costs the same); the rink
    from King St 278/1228k -> 283/1255k; Jack Couch from the stands 214/1075k
    -> 224/1118k, from the air 403/1648k -> 415/1729k; over Conestoga 70/344k
    -> 77/386k, over Grey Silo 70/408k -> 77/452k (the courses' meshes,
    ~23k tris each, and paused-harness traffic noise); 0 exceptions.
  - Approximate: the Panthers' kit and the batter's clothes are not modelled
    (crowd looks); the fence's colour and panels, the scoreboard's place and
    the light standards' count are not traced (only the aerial's shadows);
    no fielders, catcher or umpire; skaters wear their street shoes; the
    rink is open all year (the real one is a winter rink).
- **Farmsteads and churches: src/farmstead.js** (docs/farm-lane.jpg,
  farm-mennonite.jpg, village-steeple.jpg: master over this). **Two new
  classes in buildings.bin** (tools/kw/build_buildings.py): **cls 6 a farm
  building, whose roof bits (3-4) say WHICH** -- 0 barn, 1 outbuilding,
  2 silo, 3 farmhouse (`farm_kinds`; citygen `farmStyle`) -- and **cls 7 a
  church** (a Christian place of worship: tools/kw/extract_rural.py ->
  raw_rural.json `worship` / `pow_nodes`; mosques and temples stay civic).
  A farm building is one OSM tags so (barn, farm_auxiliary, silo...), or an
  untagged one in a landuse=farmyard, or in open country (no landuse zone,
  <= 12 buildings within 150 m); round = silo, long = shed, big = barn, and
  only the biggest barn of a farmstead (and any within 55 % of it) stays a
  barn -- the rest of farm_auxiliary is sheds; a house-sized one is the
  farmhouse only with a barn or silo within 170 m. 163 `man_made=silo`
  POINTS stand up as 6 m silos, and two in five 350-1500 m2 barns with no
  mapped silo near get one (a few two) off a gable end (`barn_silos`, clear
  of roads and footprints: a judgement -- most real silos are unmapped).
  ~1,000 barns, ~880 sheds, ~400 silos, ~600 farmhouses, 242 churches.
  **citygen** gives a cls-6 box its height from what will be drawn
  (`farmHeight`) and STYLES grew five names (the building cache packs the
  index). **world.meshBuilding** hands those styles to `meshFarmBuilding`
  first: everything goes into the chunk's `flat` and facade builders, NO new
  materials or draws. Bank barns: a stone stable storey, board walls on the
  facade atlas's industrial cell (tinted per channel by `ind()`, or its
  blue-grey cast turns red barns plum), gambrel (42 %) or steep gable in
  galvanised / charcoal / red / green steel, the earth ramp up to the big
  doors on the UPHILL long side (white X on a red barn), stable windows on
  the low side, ridge ventilators; > 1500 m2 or long: the modern free-stall
  / poultry barn (white steel, curtain sides, shallow roof, ridge vent).
  Silos: concrete stave (hoops, dome, chute), blue Harvestore, bare
  concrete, or (> 8.4 m across) a corrugated grain bin. Sheds: steel drive
  sheds with open bays or a slider, small board sheds, the odd white
  coverall. Farmhouses: two storeys of buff / red brick (brickhouse cell) or
  white (house cell), steep gable, chimneys, a verandah toward the road,
  and on long footprints the doddy house -- a lower narrower wing at one end.
  In `mennoniteCountry`: a steel windmill (no hydro) and a washing line in
  plain-dress colours out back (`window.__farmstead` counts them). Yard
  maples round farmhouses (trees.js). Churches: nave under a steep roof,
  lancet windows, the tower at the end nearest a street (`frontSide`) with
  a louvred belfry, an eight-sided spire and a cross, a clock on some; red /
  buff brick, limestone or white clapboard (OSM's material first). **The
  steeples are in the skyline mesh** (`steepleMass`, inset inside the near
  mesh) so every village's spire stands on the horizon. util.roofAt treats
  the five styles as pitched (`PITCHED`).
- **The villages: src/kwvillages.js** (data/villages.json from
  tools/kw/build_villages.py; docs/village-stjacobs.jpg). Each village's
  main street (`VILLAGES`: St. Jacobs' King St N -- every building with a
  wall on it; Conestogo, Heidelberg, St. Clements, Maryhill, Breslau -- only
  where OSM maps a shop): >= 330 m2 is a brick commercial block through
  kwplaces.js `meshKing` (storefronts with the real names), smaller is a
  converted house (`mainHouse`: gable, shop windows either side of the door,
  a sign board, a FALSE FRONT on half the gable-fronted ones, verandahs).
  St. Jacobs' mill at the King St bridge (OSM's untagged footprint: brick
  wings, the board-over-brick four-storey mill house) and the five Village
  Silos at King and Front (`SILOS`, placed off Esri imagery, copper cap on
  the inner one). The Mennonite Story is in the market's log cabin now
  (kwfun's market), not on King St. `window.__noVillages = true` before boot
  for a before/after; `window.__kwVillages` has stats. **Off the map**
  (it ends 15.6 km out): Elmira, Wellesley, New Hamburg, Baden (Castle
  Kilbride is ~210 m past the west edge), Ayr, Linwood. Re-run order after
  an OSM update: `extract_rural.py`, `build_buildings.py`, `build_villages.py`.
  Verify: `VIEWS=tools/kw/villageviews.json node tools/kw/kwshots.mjs <dir>`
  (farm lanes, St. Jacobs, five villages). Phone (AUTO_PHONE=1, GPU), master
  v32 -> this, draws/tris: spawn 205/980k -> 205/989k; farm lane 52/271k ->
  58/295k; Mennonite farm 33/218k -> 38/235k; bank-barn farm 58/282k ->
  58/297k; St. Jacobs King St 77/419k -> 82/446k; Conestogo 77/343k ->
  87/376k (the villages extra's Kit + atlas in two clusters: +8);
  Heidelberg 51 -> 54; St. Clements 49 -> 52; Maryhill 57 -> 62. 0 exceptions.
- **North-east Waterloo and Conestoga Doon: src/kwhome.js** (`data/home.json`
  from tools/kw/build_home.py; docs/home-*.jpg, before over after). The places
  the player grew up round, each from its OSM footprint laid against Esri
  imagery (`tools/kw/aerial.py`) and Commons photos. **University & Bridge**
  (425 University Ave E): the one 52-sided building in tan brick, storefronts
  on the faces toward the lot, FreshCo's raised green entrance over a glass
  vestibule (the bump in the aerial, `UB_FRESH`), Rexall at the north tip, a
  walkway canopy on brick posts down the south-east wing, a sign per OSM shop
  (Uncle's Shwarma, Subway's logo, New Orleans Pizza, Global Pet Foods,
  Mediterraneo), loading docks behind FreshCo, a tenant pylon at the corner
  (`pylon`, pushed off the carriageway). The Tims, 7-Eleven and Esso pads stay
  kw.js's / kwshops.js's. **The student plaza at University W & Phillip**:
  every OSM unit grouped as the building it is (`uwpGroup`: the 160 block,
  the 170 row, Molly Bloom's, the 158/160 corner, Campus Court, the building
  behind it) in red-brown brick; the roofs the aerial shows -- **Campus Court
  and the one behind it are steep shingled mansards with gabled dormers round
  a flat top** (their second storey is in the roof; `unionRing` chains the
  units' outside edges into one outline, `mansardRing` mitres it), the 160
  block a low brown hip, the rest flat behind a shingled mansard fascia; a
  sign per OSM shop over its own unit, on the face toward its lot (`UWP_LOT`).
  **Conestoga Doon**: the Recreation Centre's two dark barrel vaults
  (`REC_VAULTS`, read off the aerial's two black roofs; Commons "Gymnasium
  Corner") sunk in grass berms, the flat link and the two-storey glass front
  with CONESTOGA / STUDENT RECREATION CENTRE; the polygon wings (A-D, Welcome
  Centre...) red-brown brick at their storey heights (`CON_H`) -- **box wings
  are left alone: a new family or height on a world box was +2 draws in its
  chunk**; CONESTOGA high on B Wing toward the library pond; the Doon
  residence (99 Conestoga College Blvd, the U-shaped building, 4 storeys --
  storeys a guess). **The Bridgeport Bridge** (Bridge St E over the Grand; the
  Region's 1934 five-span concrete bowstring arch, rehabilitated): five ribs a
  side with hangers, parapet posts, four river piers, on OSM way 38742677.
  **The schools** go into kw.js buildSchools' own per-school mesh through
  `SCHOOL_HOOKS`: **St. Matthew** (docs/stmatthew-front.jpg, stmatthew-air.jpg,
  master over this) from the board's photograph of its north-east front
  (stdavid.wcdsb.ca/.../2017/06/StMatthew.jpg) and the Esri aerial: one
  storey (5.0 m roof, 0.5 m parapet under a green metal cap) of orange-red
  brick with pale courses every 0.5 m, a buff precast band at the window heads,
  tall narrow dark-framed windows in threes with buff sills; and the green
  standing-seam GABLES standing in that front (`STM_FRONTS`, each found as the
  outline edge nearest its point, its span cut out of the plain wall): the
  ENTRANCE on OSM's 8.9 m jog toward Pastern Trail (eave 5.7, apex 9.5: the
  photo is 29 px/m there) -- piers carrying the gable over an open porch, the
  cream lintel and soffit, the glazed doors 3 m back, ST. MATTHEW / CATHOLIC
  ELEMENTARY SCHOOL in sage letters (one atlas panel, as before), the round
  window with its cross; the classroom wing 23 m south-east (the photo's left
  gable: a round window in an arch of brick diamonds, `stmDiaper`, buff panels
  either side, three windows); a third gable at the north-west end (estimated:
  not in the photo); the gym's ridge roof (`STM_GYM`, 16.4 x 12 m, ridge NW-SE,
  off the aerial), three small roof monitors (`STM_MON`), the flagpole by the
  entrance (aerial), the solar arrays kept off all of them, the two portables
  (OSM's small buildings) with ramps. The old entrance (a canopy on the NW
  face) and blue coping were guesses; the photo's entrance is the jog, which the
  aerial's widest gable roof confirms. St. Matthew's own mesh 2.4k -> 4.9k
  tris; phone draws identical (drawprobe: 260 / 267 at the photo and air views,
  landmarks 121 / 122 both builds); views in kwshots: `{c: [-1502, -4843.2,
  1.7], t: [-1523.4, -4825.1, 4.8], fov: 40}` (the photo), `{c: [-1515, -4865,
  38], t: [-1557, -4822, 5]}` (the roofs). St. David (unnamed in OSM: its
  LOOKS by position, warm red brick from the 2009 Commons photo) gets its
  two-tone round drum over the glazed entrance between concrete piers on the
  east front (`STD_DRUM`, the circle in the aerial), the canopy, precast bands
  and the long wing's sloped roof glazing. buildSchools itself: St. David's
  track is BLACK with six lanes and the turf artificial (aerial), bleachers on
  the school's side; St. Matthew's two small pitches are junior soccer (OSM
  sport=soccer nodes; they were tennis courts by size), Auburn Park's diamond
  (`AUBURN_HOME`, aerial) a skinned infield with bases and a backstop; the
  monument sign stands at the board's OSM node when there is one, and **every
  box there had its rotation wrong** (`-atan2(uz, ux)`: Builder.box's local x
  is (cos rot, sin rot), so it is `atan2(uz, ux)`) -- the signs' brick bases,
  the bleachers, crossbars and lamp heads ran crosswise. **Cost: no new
  draws.** Everything is drawn through `SHOP_HOOKS` into kwshops.js's two
  builders per cluster (kw.js's footprint material + the brand atlas, whose
  canvas is 2560 tall now and crops to ~2300 used) or into the school's mesh;
  Conestoga is keyed into the cluster of kwshops' Petro-Canada/Pioneer by
  Homer Watson (`CON_KEY`). Phone (AUTO_PHONE=1, GPU), master -> this,
  draws/tris (traffic makes draws wobble +-2): spawn 205/998k = ; UB lot
  362/895k -> 361/901k; UB pylon 404/965k -> 403/968k; UW plaza from
  University 226/746k -> 224/751k, Campus Court lot 179/933k = ; St. Matthew
  front 455/1516k -> 451/1518k; St. David 155/703k -> 155/704k; Conestoga air
  191/588k -> 192/592k, Rec Centre 160/568k -> 161/572k; Bridgeport Bridge
  117/760k -> 117/763k. Cameras: `VIEWS=tools/kw/homeviews.json`.
  `window.__kwHome` has the counts; `window.__noHome = true` before boot
  turns it off. Re-run `build_home.py` after an OSM update (and `build_kw.py`
  for the schools' pitch sports and sign node). **Approximate:** St.
  Matthew's back and courtyard faces (the photo is the NE front only; the
  courtyard is roofed over, OSM maps no hole), the north-west gable's face,
  the gym's height and pitch, the porch's depth, every colour (read off one
  sunny photo); the UW
  plaza's wall brick and the UB plaza's tan brick (aerial shows roofs only);
  which face UW plaza tenants open on where OSM's node is mid-building (the
  lot side); the residence's storeys; Conestoga's dark metal upper storeys
  are not drawn; the bridge's arch rise and rib size (no photo, the Region's
  description only); E/F Wing and the other box-drawn Conestoga buildings keep
  their generic look.
- **The phone audit: `tools/kw/perfaudit.mjs`** (the sum of v21 -> v36's
  realism pass, measured; the iPhone profile, Mac GPU, 8x CPU throttle).
  `AUTO_CDP_PORT=9505 node tools/kw/perfaudit.mjs --url=http://localhost:<port>/apps/autokw/`
  boots cold then warm (boot cache) THROTTLED in a fresh profile -- first
  frame, the boot log's slowest steps, `lmRoot.userData.extraMs` (each
  landmark extra's build ms), heap, GPU ledger; `--boot-prof` a CPU profile,
  `--boot-probe=f.js` a hash after each launch -- then drives six views with
  real input for `--secs` each (spawn, King St Uptown, the Parkway at 27 m/s,
  Fairway Plaza on foot, Ring Road, a concession road): frame CPU, draws,
  tris, shadow-pass draws, ms per system, heap, GPU; `--view-prof`,
  `--shots=DIR`, `--pre='<js>'` (an A/B inside one build). To compare builds
  serve detached worktrees side by side (`git worktree add --detach`) and
  run them ONE AFTER ANOTHER, twice: run-to-run noise at 8x is +-20 % on a
  view (the Parkway read 19.8 and 31.5 ms on the same build). What the audit
  changed (all exact: the same geometry hashes, draws and triangles, cold and
  warm launches hash the same, screenshots differ from master no more than
  master from itself):
  - **Boot cache memo** for the rural decision (`rural:tag`, rural.js) and
    the footprint dedupe (`kw:dedupe`, an op list replayed in order, kw.js);
    **YKF's pavement raster per shape** over each shape's box (ykf.js: 6.6 s
    of the 8x warm boot, a fifth of it, since v11); `onCw` in highways.js
    through a per-chunk 25 m grid of the same chunk's edges.
  - **The freeway group drops its arrays once uploaded** on a phone (32 MB
    held for ever before: `highwaysRoot()` was not in main.js's drop list).
  - **`cropAtlas`** (build.js; each atlas's `finish()`): the places,
    sights, villages, campus and shared sign atlases lose their unused
    bottom rows in 64-row steps, v stretched back by the map's transform, so
    mip levels 0-6 are built from the same texel blocks. Any NEW drawing into
    an atlas must happen before its `finish()`.
  - **Landmark clusters culled whole** (`lmCull`, chunkcull.js on lmRoot):
    ~450 groups, ~1,200 meshes. Draws and triangles identical at 20 camera
    poses.
  - **Minimap place icons only inside the dial's circle** (hud.js): 364
    places since the shops and plazas; the square test drew ~10x what shows.

  | 8x, mean of two runs each | v21 | master v36 | this |
  |---|---|---|---|
  | first frame cold / warm | 42.6 / 20.0 s | 58.2 / 27.6 s | 47.1 / 22.3 s |
  | heap after boot / GPU (textures) | 448 MB / 278 (160) | 590 / 349 (216) | 581 / 342 (209) |
  | spawn: CPU ms, draws, tris | 14.0, 200, 899k | 18.2, 206, 1012k | 19.3, 206, 1010k |
  | King St: | 17.5, 250, 932k | 22.6, 262, 1056k | 21.4, 261, 1054k |
  | Parkway: | 23.1, 404, 754k | 24.4, 437, 920k | 25.6, 438, 920k |
  | plaza: | 17.6, 355, 532k | 20.7, 379, 667k | 16.4, 378, 670k |
  | campus: | 24.7, 475, 982k | 24.4, 504, 1268k | 25.2, 508, 1272k |
  | country: | 16.2, 76, 321k | 15.8, 70, 322k | 8.9, 70, 324k |

  In one build, lmCull off -> on in the country: 12.7 -> 9.8 ms. **Left as
  it is** (each would change a look or needs its own build): +110-290k
  triangles per view (the campus +29 %), +2 ms of render at the spawn; the
  logo atlas (2048 x 1984) and the freeway sign atlas are full -- shrinking
  them halves their lettering; traffic +0.5-1 ms (the fleet, semis with
  trailers, freeway lanes); the freeways' build (~1.9 s at 8x) and the
  landmark merge (~1.3 s) are geometry, too big for the memo; landmark
  arrays not yet drawn (+34 MB) are held until their first upload.
- **The phone audit, round two: traffic CPU and Chicopee** (both exact).
  **Where traffic's time went:** not the freeway lanes or the junctions
  (fwyDecide ~1 %, junctionStop + jc.decide ~3 % of traffic.update) but
  the ~180 APRON vehicles (bike docks, the dealer's lot, farms, fire halls):
  the bench without them is 0.39 ms an update at 4x against 0.82 with. Past
  300 m an apron vehicle's `_still` is 0, so it is not 'still' to the
  collision sweep, and every pair in a cluster was tested every frame
  (~1,000 tests, each a dozen megamorphic property reads). **The sweep now
  reads typed arrays** (x, z, height, radius, still flag; read again after
  any contact) and hands a pair to `carPair` only when the arrays say
  carPair's own first tests pass; the x order is `sortByKey`, a stable
  merge sort giving Array.sort's permutation without ~1,500 comparator
  calls. Plus: update's loop reads `v.mode` once, only an apron vehicle
  inside 300 m evaluates 'settles', the trailer pass walks `_rigs`, the
  neighbour scan reads the driver's own position once. Not done (tried or
  judged): skipping `sync()` for unchanged vehicles (the field comparison
  cost what sync does -- reverted); skipping it for hidden parked/apron
  vehicles (~0.07 ms at 8x, but kartway/hydrorace set `group.visible`
  after traffic.update); a spatial prefilter for driveTraffic's neighbour
  scan (exactness needs its live-list order).
  **Proof it is the same traffic:** `VIEW_PROBE_FILE=tools/kw/trafficbench.js
  AUTO_PHONE=1 node tools/kw/kwshots.mjs x` pins every source of run-to-run
  difference (Math.random, traffic.R, the signals' clock, **`_prio`, which
  is hashed into a freeway spawn's type**, the culling camera, the
  streamer settled, kerb-slot cache cleared) and hashes every vehicle after
  1,500 fixed-dt updates at six sites; master hashes the same run after
  run, and this build hashes the same as master. The fuzz probes take
  `seed: true` (`window.__hwyt` / `window.__jct`) for the same pinning:
  seeded hwytraffic and jcttraffic print byte-identical output on master
  and this. kwshots' `VIEW_THROTTLE=8` / `VIEW_PROFILE=f.cpuprofile` run
  and profile a probe; `node tools/kw/profsub.mjs f.cpuprofile 'update
  src/traffic.js' --frames=N --lines` splits one function's subtree.
  **Chicopee's lifts** (chicopee.js): towers, arms, ropes, stations were
  136 meshes, so 136 draws and shadow casts wherever the hill is in view
  (the Parkway, Fairway Plaza, even Ring Road) and 136 frustum tests a frame
  everywhere else -- `perfaudit --census` (the scene walked as projectObject
  does, per top-level group) found them as 136 of the ~200 meshes three
  culls at the spawn. Now `mergeByMaterial`: 4 meshes, screenshots identical.
  The census found nothing else worth it: highways' cells and the signal
  heads are one mesh each already, landmark and chunk groups are culled
  whole, vehicles are 1-28 culled meshes a view. perfaudit also has an
  `arterial` view (signals west of Uptown) and `--prof-out=DIR`.

  | 8x, views only, mean of two runs (each run) | master v41 | this |
  |---|---|---|
  | spawn: CPU ms, traffic, draws, tris | 11.2 (12.4/9.9), 2.96, 207, 1046k | 12.6 (13.8/11.4), 2.83, 207, 1046k |
  | King St: | 15.1 (16.7/13.4), 3.26, 262, 1080k | 12.6 (14.1/11.0), 2.57, 263, 1087k |
  | Parkway: | 14.3 (14.3/14.2), 2.67, 439, 943k | 11.7 (10.9/12.6), 2.27, 309, 946k |
  | plaza: | 10.7 (10.5/11.0), 2.04, 381, 677k | 8.2 (6.9/9.5), 1.58, 249, 677k |
  | campus: | 17.0 (17.2/16.7), 2.71, 505, 1291k | 15.1 (12.2/18.1), 2.28, 408, 1293k |
  | country: | 6.7 (6.4/7.0), 1.81, 75, 345k | 5.8 (4.9/6.6), 1.26, 72, 334k |

  Noise is the +-20 % of round one (the spawn read 9.9 and 12.4 on master).
  Traffic is 13-30 % lower in every view; the bench's profile at 4x, which
  is steadier: traffic.update 0.78 -> 0.66 ms, the sweep 0.12 -> 0.05.
  **Left as it is (would change a look):** the +110-290k triangles per
  view are mostly landmark clusters (the census: 105-265 landmark meshes
  drawn per view, the campus most); a LOD for them is a look change and
  needs its own build and a before/after of each place.

- **The phone audit, round three: the spawn's draws** (v41 207 -> v51 225
  -> 173-178; screenshots identical apart from what moves). **Every draw
  attributed:** `tools/kw/spawndraws.js` (VIEW_PROBE_FILE) hooks
  `renderer.renderBufferDirect` for one frame of the player view and groups
  the scene pass, the shadow pass and the post chain by owner (any Object3D
  two property hops from `__dbg`, then the nearest name), flagging
  zero-instance, zero-count and invisible-material draws (`__sdFull` lists
  each). `tools/kw/drawpixels.js` hides each scene-pass draw in turn and counts
  the pixels it changes in a frozen frame; `tools/kw/rangeab.js` is an A/B
  of one behaviour inside one boot, to the pixel, over a list of views;
  `tools/kw/frameshot.js` prints a frozen frame as PNG for comparing builds.
  All four freeze what moves while paused: `world.animate` (sky, water) and
  `world.trees.timeU` (the sway); kwshots' `VIEW_BOOT_FILE=tools/kw/seedrandom.js`
  pins Math.random from boot. The phone's frame is 1267 x 582 (DPR 1.45),
  1.86 mrad a pixel row.
  **What each build added at the spawn** (seeded, phone): v45 ION +4 (the
  gates, crossing lamps and catenary poles, one InstancedMesh each, and a
  third car body section); v47 +2 (a `near:nature` cluster, the river
  valley's trail furniture); v48 heavy rail +5 (`kwrail:` the Waterloo Spur's
  near and bed meshes beside the square and the far chunk at -7,0); v50 +1
  (the street-name lettering, one mesh); v51 +4 (skaters: crowd peds, each a
  SkinnedMesh, now on the rink in view; they take crowd slots, so the total is
  the same elsewhere). The delivery/taxi pillar (+1) and farTraffic (+-1)
  come and go with the game's state. No empty draws (no zero-instance mesh,
  no zero-opacity material); the shadow pass is 24 draws in every build.
  **The cut: the small flags.** 49 of the spawn's 225 draws make a pixel
  (the square is walled in); the biggest group that never can was the
  Canadian flags, a pole mesh and a cloth mesh in every 1200 m cell that has
  one, ~50 draws in every view of the region (the 1.8 m cloth is under a
  pixel past ~1 km). Small flags are now 'flags:' clusters (kwfun.js) drawn
  within landmarks.js `FLAG_RANGE` 1000 m of their bounding sphere
  (`updateLandmarkRange`, as the beaches); a dealer's 9 m flag stays in its
  cell. rangeab, flags drawn everywhere vs range-culled, pixels changed (A/A
  noise in brackets) / draws old -> new: spawn 0 (0) 223 -> 175; air-uptown
  26 (23) 317 -> 271; air-river 66 (66) 257 -> 207; air-galt 1 (1) 160 -> 144;
  air-region 18 (17) 316 -> 220; King St Uptown 0 (0) 419 -> 339; a post
  office from 300 / 900 / 1300 m 2 (1) / 5 (5) / 0 (0), 227 -> 191 / 270 ->
  228 / 327 -> 279; Fairway Plaza 0 (0) 233 -> 195; Ring Road 0 (1) 446 ->
  350; the country 0 (0) 248 -> 190. frameshot, master vs this at the spawn:
  only the clouds (the sky's time differs by boot), the skaters, the player's
  idle and its shadow differ -- master vs master differs in the same places
  (docs/spawndraws-diff.jpg, magenta). trafficbench (rail off) and ionprobe
  print the same as master; railprobe PASSes on both (its service differs
  run to run on master too: boot timing); funprobe 54/54 on both, its city
  draws master -> this: Aud 227 -> 169, Weber & Frederick 230 -> 178, the
  parade 328 -> 290, Big Splash 318 -> 235, the rink 216 -> 176, the derby
  park 226-364 -> 201-290.
  **Left as it is:** the skaters (skinned: one draw each, no batching short of
  a merged skeleton); ION's three instanced meshes and the rail's near/bed
  meshes (in view, a few pixels each); Tim Hortons' pylons and wall signs
  (`kw` clusters, 2.7-5 km away at the spawn, ~12 draws: the small stores
  built in the same clusters are buildings, which must not pop).

- **The phone audit, round four: v52 -> v79's regressions** (v80; numbers
  are perfaudit at 8x, mean of two runs). **The heap: +95 MB in one build,
  v73** (boot heap v65-v72 727-733 MB, v73 827). highways.js put a debug
  closure on `window.__hwy` from INSIDE buildHighways (`infoOf: (ei) =>
  INFO.get(ei)`): V8 keeps a function's whole closure context alive for any
  inner function that outlives it, and that context held every builder and
  array buildHighways' inner functions share. Now a module-level function:
  boot heap 830 -> 737 MB, after driving 657 -> 565 MB. **A closure made
  inside a big build function and hung on window (or any long-lived object)
  retains that build's scratch: define harness hooks at module level.**
  **Uniform uploads:** weather.js / tod.js put ~12 uniforms in every lit
  program (24 vec4s of lamp and beam arrays among them), all read only
  behind `wxOn` / `todOn`, and three flattened and compared them at every
  material switch (setProgram's `setValueV4fArray` + `flatten` 0.21 ms a
  frame at 8x at King St). They are `needsUpdate` false while their flag is
  off (`TOD_GATED`; wxWet / wxSnow); the flags themselves (and `todWinB`,
  which world.js facadeMat tests on its own) always upload, so a program
  that saw night or rain last is told it is over. nightprobe ALL OK,
  weatherprobe ALL PASS, night -> rain -> day shots clean. **What did not
  regress:** GPU time (`tools/kw/gpuframe.js`, new: frozen poses drawn in a
  tight loop, a 1-pixel readPixels per frame to wait for the GPU --
  gl.finish returns at once in Chrome, and the game's rAF is vsync-paced
  in kwshots' Chrome) is the same in clear weather as v73 (the weather /
  night blocks' uniform branches cost nothing seen), rain +0.1-0.2 ms on
  the M2 Pro. Frame CPU v52 -> v73 +0-10 %, v73 -> v79 +6-12 %, v79 ->
  v80 within the run-to-run noise (+-5 %): render (setProgram, uniform
  uploads) and traffic are most of the growth; draws and triangles are
  flat. Left: a heap snapshot sweep for other retained build scopes (565
  MB is still ~60 MB over v52's); crops.js `stream` (up to 1.2 ms a frame
  on a phone while tiles build) and `getProgram` for three materials shared
  between instanced and plain meshes (link:gates, kwrail near, the shadow
  pass's depth material for skinned meshes: ~4 calls a frame).

- **Fewer trees by the road, and less pop-in (v82).** The player found the
  streets' trees "too distracting while driving" and cars popping in as they
  drove. **Trees** (trees.js): `STREET_FILL` res 0.42 / st 0.36 / art 0.32 of a
  street's slots (was 0.8 / 0.66 / 0.6), a house's yard trees `YARD_TRIES` 3 at
  `YARD_P` 0.55 (was 4 at 0.72) with `YARD_CONIFER` 0.2 of them spruce (0.32);
  no roadside crown hangs over the lane by more than `KERB_OVER` 1.2 m (a
  boulevard tree's crown to `BLVD_CR` 3 m; yard and park trees through
  `kerbCap`, which shrinks a crown until a ring at cr - 1.2 m is off every
  carriageway); the fall colours `FALL_DESAT` 0.2 toward grey. Parks and woods
  are as they were. **Pop-in** (traffic.js, kwdriveway.js): a parked car is
  shown as long as it exists (`PARKED_SHOW` = PARKED_RADIUS + 60; a phone hid
  them past 80 m, though past FAR_LOD it draws them instanced anyway); every
  kerb slot and car-park bay no parked Vehicle holds is SCENERY out to
  `PARK_DECOR_R` (200 m phone / 280) -- `parkedScenery`, read by
  DrivewayCars._choose into traffic.decor, the exact car updateParked /
  updateLotParked would spawn there (type, colour, heading), so the swap is
  invisible and they are solid (keepOut); car parks' bays are `lotBays` per
  100 m tile on a world-aligned grid (the old scan's cells moved with the
  player, and only the 6 nearest bays ever held a car), each bay's type a
  household one (kwdriveway sceneryType: it has a detailed near LOD); the
  driveways' cars to 170 m phone / 240 (were 90 / 140); new traffic is never
  spawned inside the camera's frustum closer than `SPAWN_SEEN` 300 m (in view
  300-420 m, out of view 90-330 m; the old forward cone let cars appear at
  190 m ahead and 90 m at the view's sides). Phone, spawn views: 20-70
  scenery cars in range, draws -5..-20 (traffic's own noise and the thinner
  trees), tris -40..-100k.

- **The phone audit, round five: what a residential street draws (v85).**
  The player measured ~40 fps at `high` driving through neighbourhoods "that
  don't even have much going on" (60 at `medium`). `tools/kw/passcost.js`
  (new: each part of a frame drawn K times then a pixel read, per pose) on the
  Mac at the phone's resolution: the scene pass is ~85 % of the GPU frame
  (1.5-2.2 ms) and post 0.36 (SSAO 0.12, bloom 0.13); the scene barely changes
  with resolution (2.21 ms at pr 1.45, 1.85 at 0.5) but a flat material halves
  it -- it is geometry, 1.1-1.8M triangles. By owner and distance (a
  renderBufferDirect hook, streetdraws.js's): at a Westmount street 1.76M tris,
  of which landmark clusters wholly past 600 m 118 draws / 428k and near-ring
  chunks 600-1200 m off 315k; Doon South drew clusters 8-14 km away (73k each,
  ~1.5 px tall) behind the houses. Two cuts: **(1) a size test on the
  landmark clusters** (chunkcull.js `opts.range`, main.js): a cluster is drawn
  only within max(900 m, 150 x the height of its top over the ground) x (1 +
  the camera's height / 50) -- ~4 phone pixels for its tallest piece;
  `window.__noLmRange` before boot, `__dbg.lmCull.sizeTest` live. rangeab
  (seeded, phone), size test off -> on: spawn 177 -> 143 draws, 0 pixels;
  Westmount street 298 -> 173, 0 px; Doon South 238 -> 109, 0 px; air views
  209 / 327 unchanged, 1 px; 60 m up a hill 363 -> 296, 167 px of 737k.
  **(2) the near ring is round**: world.js's (2, 2) corner chunks are mid
  ring (they start 1.13 km out). Both: Westmount 329 -> 239 draws, 1761k ->
  1486k tris; Doon South 232 -> 158, 1427k -> 999k; Activa 152 -> 142,
  1108k -> 988k. Not done: SSAO and the second bloom pass at `high` (0.1 ms
  each on the Mac), the far scenery cars (~88k tris at Westmount), the
  near-ring houses' detail inside 600 m.

- **The phone audit, round six: trim what a pixel cannot show (v86).** The
  player's phone: ~40 fps at `high` round Uptown, 60 at `medium` (the same
  geometry; `high` adds SSAO, a second bloom pass and 1.45 vs 1.3 pixel
  ratio). By source (a face3/face6 counter over a near-ring build at
  Westmount, 21 chunks): buildings 636k triangles, of them driveways 134k
  (`_driveStrip`: boxes, 10 triangles for the 2 seen), fall dressing 93k (potted
  mums ~100 each), kits / fences 44k; kerb props 92k. Cuts: **(1)** driveway
  pieces are ground quads (corner heights + 8 cm, shared piece to piece);
  **(2) lean near chunks** (world.js `LEAN_D2`): a near chunk 400 m+ out
  (dx^2 + dz^2 >= 4 in the ring) is built without kerb props, hydro, street-name
  posts, yard fences, driveway kits, fall dressing, garage joints or porch
  rails -- meshProps and the posts run into a `SinkBuilder`, so solids, lamps
  and the trees planted round them are the full build's; a full chunk never
  goes back to lean; `c.lean` / `c.wantLean` beside lod; **(3) far-far cars**
  (vehicles.js `farLod2`, traffic.js `FAR2` 110 m phone / 150): the far LOD
  clustered again at 0.45 m, from its own arrays at boot, a `type|2` pool in
  farMeshes; **(4)** ION's structure drawn to 1300 m on a phone (was 1900).
  Phone (AUTO_PHONE=1, GPU, seedrandom), v85 -> v86, scene draws / tris at the
  driver's seat: Uptown King 199/1079k -> 199/1009k; Westmount 242/1492k ->
  246/1341k; Mt Hope 215/1335k -> 218/1191k; Breithaupt 278/1597k ->
  279/1517k; Doon South 157/1000k -> 162/902k; Activa 142/988k -> 144/862k;
  Galt 167/1181k -> 169/1062k (farTraffic 90k -> 53k at Westmount, 49k ->
  20k at Activa; +1..+6 draws for the far-far pools). Screenshots against v85
  at street level and 60 m up: no visible change. Debug stats now persist
  (localStorage `autokw-debug`). Not done: the landmark clusters past 600 m
  (150-320k at these views: campus and downtown clusters with a tall piece,
  kept by the size test to 4-6 km), the far crowns inside the instanced
  trees' range, `high`'s post chain on the phone (not measured on the device).

- **The phone audit, round seven: Caroline St behind the square (v87).**
  The player's slow street (30-40 fps): Caroline St N/S behind Waterloo Public
  Square by ION and the Clay and Glass Gallery. Not GPU (passcost: the scene
  1.7 ms there as at King St or the spawn) but CPU: perfaudit at 8x (its new
  `caroline` view) 15.0 ms a frame mean, p90 21 -- render 7 (210 draws), traffic
  3.4. Cuts, all exact (trafficbench hashes, ionprobe PASS, nightprobe ALL OK):
  **(1) the flags are instanced** (kwfun.js `FLAGS`): every flag was a pole and
  a cloth mesh in its cell's cluster, ~32 triangles for two draws, ~24 draws on
  Caroline; now one pole + one cloth InstancedMesh for the small flags (refilled
  within FLAG_R 1000 m when the camera moves 20 m) and one of each for the
  dealers' big ones, the wave's phase from the instance's position
  (`window.__kwFlags`); **(2) far-far cars pool by body** (traffic.js `FAR2_AS`:
  sedans as the compact sedan, SUVs and minivans as the crossover, pickups as
  the pickup; liveried types their own) -- one pool a type was 16 far draws
  there; pools upload only the slots in use (`addUpdateRange`);
  **(3) ION's `blocks()`** rejects a point in no train's circle (made once a
  frame) before any `nearest()`: 0.43 -> ~0 ms; **(4) the shadow pass's depth
  material** gets a clone per (material, side, skinned, instanced, morphed)
  (main.js `stableShadowDepth`): three's one shared MeshDepthMaterial changed
  program at every switch between them (getProgram, 0.2 ms a frame); the
  crossing gates and lamps get their own material (xing.js `instMat`);
  **(5)** crops.js scans for tiles only when the camera has moved 3 m;
  memory.js tracks the two common buffer bindings in variables. 8x, v86 -> v87,
  two runs each: Caroline 14.93 / 15.05 -> 13.44 / 13.07 ms (p90 21 -> 19),
  draws 207 -> 190; King St 13.8 / 14.3 -> 12.4 / 12.3, draws 181 -> 158; spawn
  12.5 / 13.1 -> 11.8 / 11.8, draws 146 -> 139. Left: traffic's 3 ms (the
  driving model of ~30 moving cars), landmark clusters' many materials (33
  draws at Caroline), the near chunks' 4 draws each.

- **The phone audit, round eight: traffic (v88).** The player: 60 fps on an
  empty road, ~40 as soon as there was traffic, at `medium` too. CPU, not GPU:
  perfaudit with traffic off vs on, 8x, arterial 11.3 vs 15.2 ms, King St 9.9 vs
  13.1; with ~5 cars about, traffic.update alone ~4 ms. Four things, measured
  by trafficbench at 8x (AUTO_PHONE=1, `VIEW_THROTTLE=8`):
  **(1) one hidden class for the fleet** (vehicles.js constructor): traffic.js,
  junctions.js, schoolbus.js, main.js, bikes.js, grtbus.js and Vehicle.update
  itself added ~60 fields to a vehicle as it first met a junction, a lane
  change, an exit, a gravel road... -- traffic cars ran through 7 shapes, the
  fleet through 15, and every loop over `traffic.cars` (the scan, the sweep,
  sync, lamps, peds) went megamorphic. Declared as `undefined` (every read
  tests as before; `dynW`'s undefined means something): 1 shape for all 221.
  Desktop trafficbench hashes = v87 at all six sites. Check it with
  `AUTO_JS_FLAGS=--allow-natives-syntax` (tools/chrome.mjs, new) and
  `%HaveSameMap` over the list. **Any new per-vehicle field: declare it in
  the constructor.** **(2) the driver thinks every other frame past `AI_FULL`
  25 m** (traffic.js update; the car still moves every frame on what it
  decided), and the whole-update rate goes by distance: off screen every
  other frame from `AI_OFF` 50 m (was 80), every third from `AI_OFF3` 200,
  on screen every other frame from `AI_SEEN` 150 (a step there is under a
  pixel). **(3) the population ring** (phone): DESPAWN 520 -> 420, SPAWN_FAR
  420 -> 370, out of view 90-300 m (`SPAWN_HID`, was 330), TRAFFIC_TARGET 26
  -> 19 (the area's share, rounded up). **(4) FAR_LOD 60 -> 40 m** (the
  scenery cars' own swap, DECOR_NEAR), SHADOW_NEAR 45 -> 40, one ground
  sample past FAR_LOD. trafficbench ms, v87 -> v88: uptown-king 2.20 -> 0.82,
  sig-1644 1.67 -> 0.76, pkwy-fairway 1.62 -> 0.65, 401-hespeler 1.61 ->
  0.68, allway-28 1.29 -> 0.65, rb-3lane 1.40 -> 0.65 (the 190 apron
  vehicles were ~0.8 of it before the shapes; noApron 0.5-0.6 then).
  perfaudit 8x frame CPU (two runs each): spawn 11.6 -> 9.8, King St 14.1 ->
  11.7, Caroline 13.1 -> 11.9 ms; with 8 cars kept round you (a pre that
  spawns them 20-65 m off) arterial 17.3 -> 14.0, King 15.2 -> 12.5, p90 25
  -> 21. Phone fuzz (AUTO_PHONE=1, seeded): jcttraffic v87 1 hit / 2
  recycled -> 0 / 0; hwytraffic 0 hits both, freeway speeds within 3 %.
  Phone trafficbench hashes change (meant: the rates and the ring).

- **QA sweep after v22-v39** (docs/qa-*.jpg, before over after).
  `tools/kw/sweeppick.js` picks ~60 road points (fixed spots: Uptown,
  downtown, Galt, St. Jacobs, UW, WLU, Conestoga, plazas; the rest a seeded
  draw by road class) and prints a VIEWS list, four driver's-eye shots a
  point (recipe in the file; ~25 min for 240 shots). Found and fixed at the
  root: **(1) wall signs on bridge arms** -- OSM draws E3's enclosed bridge
  to E5 as part of E3's outline, and the nameplate went on the face nearest
  the street: the bridge's side, 3.2 m over Ring Road, mirrored from the
  approach. kw.js `polyFace` now only offers walls backed by 3.5 m of the
  outline (not a narrow arm) and, for nameplates, not over a road.
  **(2) freeway signs off decks** -- highways.js `standOk`: no sign where
  its frame is on a deck (`e.elev`) or the ground at its posts is more than
  `STAND_DROP` 4.5 m below the road: exit 278A's gantry stood on the 401's
  Grand River bridge with a 19 m post to the river bed, three ground signs
  did the same; advance signs and route markers now try a few distances
  (50 gantries before and after; shields 51 -> 56, speed signs 62 -> 60).
  **(3) crosswalks crossed over each other** at a split approach's mouth
  (the two one-way legs' crossings, each moved out to its own mouth):
  junctions.js `xingClash` draws only the lower edge's when the strips
  cross or overlap side by side. **(4) signal poles and stop signs in the
  road** (above, Junctions). The grass hairline at Galt, the garage doors
  over windows and the fences through trunks it saw are fixed in
  "Follow-ups after v49" below; "the gantry behind Conestoga's Rec Centre" from (5560, 6985) is
  inside E Wing's box -- what floats there is E Wing's rooftop units seen
  from inside the building, not a sign.

- **Jobs only Waterloo Region has: GRT bus driver and KW Eats**
  (src/grtbus.js, src/kweats.js; docs/jobs-*.jpg). Both are on the map, in the
  pause menu's Jobs list (`jobRows()`, ahead of the races) and in the
  Passport's extra line; `window.__noJobs = true` before boot leaves both out.
  **GRT** (`data/grt.json` from tools/kw/build_grt.py, which reads OSM's GRT
  PTv2 route relations straight out of kw.osm.pbf: the `platform*` members in
  order are the stops, the role-'' ways chained are the line). `SECTIONS`
  picks 9-12 stops from a terminal: 7 King (Conestoga Station -> Waterloo
  Public Square), 202 iXpress (The Boardwalk -> UW), 201 iXpress (Conestoga
  Station -> Fischer-Hallman / Columbia), 57 Blair (Ainslie Terminal -> Blair
  / Bismark); the script asserts every stop lies within 45 m of its line. A
  bus is parked ('apron') at each section's first stop (`spawnBuses`); being
  stopped in a GRT bus within `START_R` of it starts the run. The front sign
  is a canvas plane over the baked LED sign (`Sign`, on `v.tilt`, with dark
  quads over the two kerb-side doors when they are open) -- the baked sign is
  per TYPE, so a run never needs a new type. Riders are the crowd's own
  pedestrians: `fare` 3 is a new value peds.js already honours by accident
  (only 2 walks, only 1 hails), so a waiting rider stands facing the road; to
  board they walk (`fare` 2) to the front door and are removed, alighting
  ones are `spawnFareAt` the door walking away. A stop is SERVED when the bus
  is stopped with the stop's kerb point (`_kerbPoint`: the route line
  offset to the near lane) between 5 m behind and 11 m ahead of its centre,
  on the kerb side; it is MISSED 28 m past it along the route. The timetable
  (`sched`) is each leg's length at 8.5 m/s (10.5 iXpress) + 15 s a stop --
  derived, not GTFS; up to 60 s late is on time, early is fine except at a
  TIMEPOINT (a station / terminal, every third stop), where the doors stay
  open until 30 s before the timetable ("holding for time") and pulling
  away sooner costs that stop 40 points. SMOOTH: hard braking
  (> `HARD_BRAKE` held `HOLD_T` at speed), hard turns (> `HARD_LAT`), kerb
  strikes (a kerb-side corner over `roadLift` 0.3 while the centre is not),
  crashes, a pedestrian hit, pulling away with riders still walking. Pay =
  $10 a stop served + score / 10; bests in `autokw-grt`. The LED panel at
  the top (`LedPanel`, a DOM element shared with KW Eats) shows the route,
  the next stop, distance, schedule delta and smoothness; the route and the
  next stop are drawn on both maps through `hud.fare` (the taxi's).
  **KW Eats** (`data/eats.json` from tools/kw/build_eats.py): 122
  restaurants (delivery chains from raw_shops by brand, local favourites by
  OSM name -- Lazeez, Pita Pit, Ennio's, Morty's, Gino's, Campus Pizza,
  Kismet, Mozy's... -- and Mr. Panino's at 170 University Ave W, which OSM
  lacks), each with a food kind; 1,580 real addressed homes (OSM house /
  detached / terrace / apartments ... with addr:*, one per 170 m cell, door
  = the footprint's point nearest its own street from raw_roads.json).
  Riding a road car under 7 m, a bike or a motorbike, the nearest kitchen
  within 230 m gets an orange pillar; stop within 48 m (its point can be
  deep in a plaza) and the order is
  bagged (3 s), then it is for a door 0.6-3.2 km off with a quote from the
  distance and the ride. Lateral g past 4.5, braking past 8 m/s^2, landings
  and crashes spoil it x its kind's `sens` (ramen 1.6 ... shawarma 0.55);
  tip = 30 % of the order's value x lateness x condition^1.5; cancelled at
  2.5x the quote. Stop within 30 m of the door (45 an apartment block's: they sit
  back from the street) or walk it within 4.5 m.
  The next order pings from a kitchen within 1.6 km. Stats in
  `autokw-eats`. **Verify: `node tools/kw/jobsprobe.mjs <dir> [grt,eats]`**
  (AUTO_GPU=1; `GRT_ROUTE`, `EATS_REST`): the game running, everything
  through `Input.dispatchKeyEvent` (F, W/A/S/D) from a small autopilot,
  prints `__grtLast` / `__eatsLast` and shoots the board, a stop, the
  drive, the kitchen and the door. It sets `Emulation.setFocusEmulationEnabled`:
  without it the headless page went `document.hidden` on entering a
  vehicle, which pauses the game (visibilitychange) and stops its frames.
  Sounds: `bus_chime`, `bus_doors` in audio.js SOUNDS. Both jobs read the
  ride through `Feel` (grtbus.js): fore-aft from d(vLong)/dt and sideways
  from vLong x yaw rate, smoothed ~0.2 s -- the world velocity's derivative
  read 1-2 m/s^2 of phantom sideways g from the slip angle flickering under
  keyboard steering. Grade: stops (130 each) + smoothness worth 35 % of
  them. Probe results (autopilot, so the smoothness is the autopilot's):
  57 Blair 10/10 served and on time, held for time at the timepoints, 3 kerb
  strikes and 3 pedestrians clipped on the way, $230; KW Eats Campus Pizza
  -> 23 Dunbar Rd N, 1.1 km, 3:57 against a 3:19 quote, pizza 51 %. Phone
  (AUTO_PHONE=1, GPU), jobs off -> on: Uptown street 223 -> 223 draws,
  934k both; Conestoga Station with the 7 and 201 buses parked in view
  124 -> 130, 395k -> 418k. A run adds the sign and doorway quads (2 draws,
  your bus only), KW Eats one pillar.
- **Heavy rail: src/kwrail.js** on `data/rail.json` (tools/kw/build_rail.py,
  after extract_rail.py; docs/rail-*.jpg). Four lines trains RUN on, each one
  track walked on OSM's nodes: `guelph` (the Guelph Sub, CN west of Kitchener,
  Metrolinx east, edge to edge, 34 km), `galt` (CPKC's Galt Sub through
  Cambridge, edge to edge; OSM's named ways stop 900 m short of the south
  edge, so the crop CLIPS a segment at the box instead of dropping it, and an
  end short of the edge is carried straight on to it), `wsub` (CPKC's Waterloo
  Sub, Galt to Kitchener, ends in the map) and `spur` (the Waterloo Spur from
  WCR's Waterloo station at Northfield north to Elmira -- south of Northfield
  it is ION's track, so it is not drawn twice). `twins` (OSM tracks beside a
  line for >= 250 m: the double track through Kitchener, sidings) become
  PASSING PLACES (`pp`: s0, s1, lateral `off`, eased in over `KWRAIL.ramp`);
  `static` is every other track in the box (yards, the Huron Park and Fergus
  spurs, the freight-only spur through Kitchener to Uptown): drawn on the
  ground, flush across roads, never run on, in <= 300 m pieces for the lazy
  chunks. The beds are carved as freight.js's (`geo.setRailCarve`, set in the
  constructor, BEFORE citygen; profile memoized per build -- delete the
  shots profile after changing it), at a 2 % grade; `_pinCrossings` then sets
  every level crossing to its road (the 1 % envelopes left one 4 m over Bingemans
  Centre Dr). **Crossings are shared with ION: src/xing.js** (the Canadian
  mast, `XingSignals` = arms + lamps in one instanced draw each, `xingClosed`
  = the AI stop; link.js uses the same code). Heavy rail's masts carry the
  bilingual crossbuck (RAILWAY CROSSING / TRAVERSE DE CHEMIN DE FER) and a
  "2" plate where two tracks cross; the spur's narrow country roads get
  lights only; static-track crossings get a crossbuck post. traffic.js calls
  `kwrail.blocks(x, z, y, car)` (as `traffic.freight`): a car already between
  the gates drives on clear instead of stopping on the tracks.
  **The fleet** (railcars.js, atlas now 2048 x 2176, `atlasUsedH` ~2140; BNSF's
  hood/wing cells are gone): GO MP40PH-3C 647/612/660 + ten BiLevels + cab car
  (loco at the WEST end, `ori` -1: it leads into Kitchener and pushes back to
  Union), VIA Siemens Charger + 4 Venture cars + cab car, CN ES44AC freights
  with CN/TTGX autoracks, CPKC (ES44AC 9375 in the 2024 CPKC livery, 8781 in
  CP's 2012 scheme, a trailing unit `~` turned) with CPKC boxcars/hoppers,
  autoracks, tank cars, and WCR's GMD-1 1012 (green and gold) with three
  heritage coaches. A train is freight.js's SkinnedMesh (3 draws, a bone a
  car; cars off the line's ends hidden by bone scale 0, so trains drive on
  and off the map); passenger stock is not weathered. Liveries are read off
  photos (est.), see railcars.js's header.
  **The dispatcher cannot lock** (the banker's algorithm, `_state` /
  `_canRun` / `_safe`): the line's state is SAFE when its trains could all be
  got off it in some order, each running alone while the others stand
  (through blocks no standing train is in, passing places with a track no
  standing train holds; a GO's turn at Kitchener is part of its run). Every
  decision is a move checked safe before it is made: entering a block (with
  `_free`: nobody in it or committed to it the other way) together with its
  LANDING (a track reserved at the passing place at the block's far end,
  `npp`), taking a track mid-line, and coming onto the map. From a safe
  state the first train of that order can always make its next move, so no
  two trains ever wait on each other. Fairness on top (`wantBlk` /
  `wantSince`, first come): a block goes to the train waiting longest for it
  the other way if that one could go once the block clears (`_couldGo`: its
  landing free and its move safe, the block's occupants projected to where
  they are bound); the LAST free track of a passing place is kept for such a
  train (`_lastTrackOwed`, spawns too); and nothing new comes on a line
  while a train on it has been held 45 s. The timetable keeps meets short
  (`_meetWait` and the entry rules in `_dispatch`: "Follow-ups after v49"
  below) -- the block west of Kitchener is 14.8 km. Dispatch uses only passing places
  every train of the line fits (`line.disp`; the rest are drawn). `_rescue`
  acts only if a line's state is ever found UNSAFE (a bug; the probe fails
  on it). Compressed timetable (`_schedule`, `_retire`): 3 GO sets
  (in from the east, 2 min at Kitchener, back east), VIA alternating ends,
  2 CN, 3 CPKC on the Galt Sub, the CPKC local shuttling the Waterloo Sub,
  WCR shuttling Waterloo - Farmers' Market - St. Jacobs - Elmira (40 s
  calls, 150 s at the ends). Horn: CROR 14(l) long-long-short-long before
  each crossing; bells; urgent blasts and braking for you on the track, and
  a hit if you stay. audio.js hears `kwrail.audible` through its freight
  voices. `window.__noRail = true` before boot turns it all off.
  **Verify**: `VIEW_PROBE_FILE=tools/kw/railprobe.js node tools/kw/kwshots.mjs
  <dir>` -- two hours of service (no two trains in each other, every train
  runs, GO/VIA call at Kitchener, WCR at all four, NO rescue, no train held
  over 10 min) and five
  crossings with traffic round you (lights >= 15 s before the train, gates
  down, cars held, none on the tracks under the train, none past a lowered
  gate); `tools/kw/ionprobe.js` must still PASS (xing.js is ION's too).
  Last runs (7): 26-28 trains on in 2 h, 20-24 meets, 0 rescues, longest
  hold 378-559 s; every crossing held
  2-10 cars, 0 violations. Phone (AUTO_PHONE=1, GPU), rail off -> on: spawn
  212/1052k -> 217/1086k; Kitchener station 280/1196k -> 303/1266k (a GO
  set in view); Galt Sub 159/491k -> 174/549k. Not done: the GO layover yard
  and Kitchener's second platform (trains turn on the platform track),
  Waterloo Spur freight (CN's night locals) and freight south of Northfield
  on ION's track, CN locals on the spurs, real day-of-week WCR service.
- **The Grand River valley: src/kwnature.js, the trails, the woods**
  (docs/nature-*.jpg). **The river:** `geo.riverField()` marks the wet
  vertices of every body whose level falls > 1.5 m across it (build_raster's
  own river/lake rule); world.js's water mesh carries `aRiv` (river, next to
  the bank, riffle) and `aFlow` (downstream) per vertex, and its shader turns
  a river's body olive-brown instead of the sea's black and breaks the
  riffles (value-noise patches along the rivers, ~15 % of river vertices)
  into white streaks drawn out and carried downstream, rougher and choppier.
  Still one water draw. **The banks:** kwnature `forShore` finds every river
  shoreline exactly where the meshes meet -- the zero of (terrain - water)
  on their shared triangles -- and lays a 1.6-4 m limestone shelf up the
  bank with limestone blocks along the water line; downtown Galt (`GALT`
  box) gets a coursed limestone retaining wall with a cope and the paved
  riverwalk behind it instead (solids). **The trails** (bikes.js; data from
  tools/kw/build_bikepaths.py, re-run it after an OSM update): flags now say
  what each is made of -- 4 earth, 8 stone dust (fine_gravel / compacted /
  gravel / unpaved: most of the Walter Bean and the rail trails), 16
  boardwalk, 32 foot only -- and the named walking trails and boardwalks
  are in (497 km, was ~430): drawn without painted lines, the edges going to
  grass, a boardwalk as a raised deck over marsh or water (Huron Natural
  Area, Laurel Creek). **Walkers:** `Cyclists` keeps 3 (phone) / 6 people out
  for a walk on the trails (not street cycle tracks): peds.js `spawnTrail`,
  steered through `p.trail` each frame; they count against the crowd's
  MAX_PEDS (a full crowd gives up its farthest pavement walker). **Trail
  furniture:** 97 trail bridges no one else drew (a road bridge's own footway
  is the road import's, Waterloo Park's kwplaces') as walkable decks
  (platforms; `P.deck` makes them rideable/walkable, cyclists stand on
  `city.platformAt`), with 5.4 m over any road they cross and no pier in a
  lane; ~80 trail signs (the trails over 2 km long, where they meet a road,
  one per 700 m: green, the Trans Canada red); ~990 benches. **Doon Pioneer
  Memorial Tower** (OSM 827907152: fieldstone hexagon, white-columned
  lookout, concave copper roof, wagon vane; its footprint box is skipped)
  and **the West Montrose Covered Bridge** (OSM 35928828 -- it is on the
  map, 750 m inside the north edge: red pine boards, cedar shingles, the
  pier, raised on steel cribbing and fenced with BRIDGE CLOSED, because it
  is: closed Aug 2025 for the Region's rehabilitation, reopening spring
  2027; walkable). **Where it draws (phone):** tower, covered bridge and
  Galt walls in kwsights' Kit (`addSights`); the signs in `near:nature:`
  clusters; banks, benches and trail bridges INTO bikes.js's lazily built
  1 km ground chunks (`bikeNet.ground = groundDetail`; bridges are recorded
  at landmark time for their platforms and replayed into the chunk). In
  the landmark clusters they were +50-100 draws in a wide view -- a merged
  cluster mesh over 60k vertices is a stray of its own, so every flush is a
  draw. **The woods:** trees.js's palette is KW in mid-October (sugar
  maple orange and gold, red maple scarlet, oak russet; white pine, cedar,
  spruce), a woodlot 7-23 % conifer (a plantation or cedar swamp where the
  stand field runs high), a quarter of that within 50 m of water (the
  floodplain forest), park conifers 20 % (were 34), maples 42 % of a wood.
  Phone (AUTO_PHONE=1, GPU), master -> this, draws/tris: spawn 206/1042k ->
  209/1045k; Bridgeport Bridge down the Grand 423/857k -> 424/895k; the
  Walter Bean at Bridgeport 330/697k -> 333/747k; the Iron Horse 420 -> 423;
  Galt Main St bridge 262/923k -> 267/951k; Galt riverwalk 124 -> 128; the
  tower 135/648k -> 138/702k; Kissing Bridge 46/291k -> 50/314k; Laurel
  Creek air 98 -> 99; Doon air 180/674k -> 185/719k; 0 exceptions. (Paused
  harness views keep last frame's walkers -- skinned meshes, never
  frustum-culled -- which is most of the +3.) Verify: kwshots views need
  `eval: "(()=>{const b=d.bikeNet; b._tick=0; b.update({position:{x:V.c[0],z:V.c[1]}}); for (const n of d.lmRoot.userData.near) n.o.visible=true;})()"`
  -- a paused game builds no bike chunk and updates no 'near:' range, so
  without it banks, benches, bridges and signs are missing from the shot.
  `tools/kw/drawprobe.js` (VIEW_PROBE_FILE; `window.__probeViews`) lists the
  draws in a view by mesh name; `tools/kw/trailprobe.js` puts you on a trail
  (`__trailAt`) and reports the walkers. **Not done:** Laurel Creek's
  reservoir beach (OSM maps no beach there), McLennan Park's hill is the
  DEM's own (~30 m, no toboggan run or ski hill drawn), Bechtel Park and
  Snyder's Flats are their OSM green and water only; the Grand's width is
  OSM's water polygons at the 40 m water mesh; riffle places are noise, not
  surveyed; Galt's walls are one generic wall (heights from the bank, not
  measured).
- **Street-name signs** (src/streetsigns.js, `data/streetsigns.json` from
  tools/kw/build_streetsigns.py; docs/streetsigns-*.jpg). The designs were
  checked against photos and the City of Waterloo's standard drawing CW-611
  (2023), not guessed: **Waterloo** green between two 25 mm white stripes,
  mixed-case Clearview with the abbreviation smaller, no full stops ("White
  Elm Blvd"); **Kitchener and Cambridge** green with a white border, mixed
  case, "St." ("Queen St.", "Ainslie St.", photos at Weber/Queen, Courtland/
  Sydney, Main/Ainslie); **downtown Kitchener** the white arched blade, black
  capitals, maroon band with the district ("KING ST.E / MARKET DISTRICT",
  photo at King/Cedar; the four districts and their centres are from the
  City's Downtown Districts map, their reach `DISTRICTS` read off it by eye;
  only the Market District's blade was photographed -- the other three are
  assumed to match); **the townships** green, white border, CAPITALS on wooden
  posts (Elmira's "ARTHUR ST", Wilmot's "SANDHILLS RD."), **Wilmot's** with
  the civic numbers each way ("<- 2962   2983 ->", from OSM addresses, back
  face swapped); **Regional Roads** the white WATERLOO / n / REGION flowerpot
  (OSM `ref` "RR n") on the blade post, one-sided, facing the junction;
  **mast arms**: a big green sign naming the cross street on every signal
  approach's arm (Kitchener, Waterloo and Cambridge all do; not downtown
  Kitchener). Municipality = OSM admin_level 8 polygon at the corner;
  anything outside the Region's three cities gets the township blade.
  **Where:** every junction node (>= 3 edges, no ramps/freeways/elevated/
  roundabout rings) with two street names; nodes joined by edges < 32 m are
  one intersection (a divided road), drawn by its lowest node. One corner,
  or two diagonally opposite when a street is art/st; the corner is between
  two neighbouring arms of DIFFERENT streets, the post on the bisector, out
  past the kerb until `onRoad` (pad 0.7), buildings and water say clear; each
  blade names the arm beside it and is parallel to it. At a signal the
  blades go on two of its poles (`jc.rigs`, 4.35 m) instead. **Drawing:**
  posts, blade extrusions, the mast-arm sign's aluminium back and shield
  plates are in the near chunk's flat mesh (`meshChunk`, called from
  world.js after junctions', after a yield: no draws; far off a blade is a
  green bar). The LETTERING is one mesh of quads within `LETTER_R` (150 m
  phone / 240) and `OVER_R` (230 / 330) for the mast-arm signs, rebuilt every
  0.5 s or 25 m (`gather`) over ONE atlas of 512 x 64 slots (2048 x 512 on a
  phone, 32 slots, ~5.6 MB with mips; 2048 x 1024 desktop) paged LRU by art
  key: a new name is drawn into a 512 x 64 scratch canvas and copied into its
  slot with `renderer.copyTextureToTexture` (one slot's upload; mips once per
  rebuild), at most `UPLOADS` (2 phone / 8) a rebuild, the rest next frame.
  Corners are worked out lazily per chunk and kept. `window.__noStreetSigns
  = true` (VIEW_BOOT_JS) turns it all off for a before/after;
  `window.__streetSigns` has the counts. **Verify:**
  `VIEW_PRE_FILE=tools/kw/streetsignpre.js VIEWS=tools/kw/streetsignviews.json
  node tools/kw/kwshots.mjs <dir>` (`__ssView(a, b, x, z, {arm, back, over,
  close})` frames a corner by its street names); `tools/kw/streetsignfixed.json`
  is the same views baked to cameras (for before/after);
  `tools/kw/streetsignprobe.js` dumps what a few corners got;
  `tools/kw/streetsigndrive.js` (VIEW_THROTTLE=8) times it down King St.
  Phone (AUTO_PHONE=1, GPU), off -> on, two runs each: spawn 212-213/1047-1051k
  -> 214-215/1056-1064k; Uptown King/Erb 300-304 -> 300-305, +9-14k tris;
  King/Cedar 213-214 -> 214-216; Laurelwood suburb 96-97 -> 97-99; Woolwich
  rural 166-167 -> 167-169; Wilmot 69-70 -> 70-72; Westmount/Alexandra
  277 -> 278-279; Galt Main/Ainslie 99-100 -> 100-102; 0 exceptions (the
  lettering is exactly one draw; the rest is run-to-run noise). 8x CPU down
  King St (3 km, Uptown to the market): a rebuild 0.9 ms mean, 9.5 ms worst
  (the uploads; GPU-side), corners ~3-5 ms a chunk inside the chunk build.
  **Not done / approximate:** no block numbers on city blades (the photos
  show none; Wilmot's numbers are the nearest OSM address each way, not the
  block's first); one Kitchener photo shows a BLUE "YOUNG ST" blade on a
  signal pole at Weber -- not modelled; North Dumfries' and Wellesley's
  blades were not photographed (township design assumed); Woolwich's small
  logo at the blade's left end is not drawn; township road numbers ("WILMOT
  16 TWP" on Wilmot's blades) are not in OSM; the font is Helvetica, not
  Clearview; blades sit on their own post, never on a stop sign's or a hydro
  pole (as many real ones do); unlit (MeshBasic, like the freeway signs).
- **Follow-ups after v49** (docs/followup-*.jpg, before over after). Each at
  the root, with the probe that shows it:
  - **Heavy rail is felt** (roadfeel.js): `kwrail.feelTracks(x, z, R)` hands
    roadfeel every track within 8 m as a local frame (`k`, X, Z, h, y,
    `cross`): the running lines, a passing place's second track at its
    `ppOff`, and the static spurs/yards (`_feelSegIndex`, 32 m cells built
    the first time it is asked). The same rail-crossing test as ION's; a
    crossing's panels 0.85, ballast 0.9, a spur set in the road 0.6.
    feelprobe's `hrail` phase drives one crossing per line, a double-track
    one and a spur's: 0 -> 4 hits a track (stats `hrails`).
  - **A solo crash costs the car health** (player.js): over 5 m/s into a
    wall, building, parapet or pole, `v.damage(0.7 x impact)` -- traffic.js
    carPair's rule, through damage()'s debounce and your car's 60 %. A
    60 km/h wall: 100 -> 88 (feelprobe `crash`), so the smoke (< 45 %), the
    doubled smoke (< 25 %) and the misfire (< 33 %) come from solo crashes;
    at 0 it burns for BURN_S and blows as before. Respawn is unchanged (you
    leave the car; the next one is new).
  - **The Guelph Sub's meets** (kwrail.js `_dispatch`): OSM maps no siding,
    disused or not, west of Kitchener inside the map (CN's single main to
    the edge; the `twins` are all at Kitchener and east), so the timetable
    does it. A train is held off the map (`dueT`, counted in
    `stats.meetHolds`) while: one bound the other way through its first
    block would stand more than `MEET_SLACK` 150 s at the far end
    (`_meetWait`: block length / 0.8 v against the other's arrival at 0.75
    v plus its dwells; a westbound GO turns at Kitchener, so it is not one);
    one bound the other way is standing for a block; the line has as many
    trains out as passing places (Guelph 3, Galt 2); another due train has
    waited longer; or it would take the last free track where a GO on its
    way in turns. `MEET_HOLD` 900 s off the map overrides the first three.
    GO sets come back every ~10 min (`_retire`, was 7). railprobe, 13 runs:
    every one PASS, longest stand 385-431 s (was 378-904, 3 of 10 over the
    10-minute limit with the first rules alone); calls GO 3-5, VIA 1-2.
  - **Junction leftovers** (traffic.js, xing.js). Stop sign 3701 (Gildner
    St onto Park St): a 100 deg left. A route moves on to its next entry
    when the car passes the vertex along the old line, and on a corner over
    90 deg the arc never gets there ((a - t) + R < a): the car circled the
    junction for minutes until a car on Park St hit it. Over 90 deg it
    moves on at the arc's middle. Signal 384 (Erb St W): two lanes into one
    at a node, both cars' lines jumping to the one lane, abreast -- a car
    whose lane line jumps > 0.9 m at the end of its (city, one-way) edge now
    gives way to a car on the same edge bound for the same lane that is
    ahead or abreast and older (`cityMerges`; freeways keep fwyDecide's
    `dropT`). Signal 776's scrapes were the same >90 deg circling. Also
    found: sig-1644's crash every 8 s was a heavy-rail crossing MAST in the
    lanes of the street beside its road (xing.js now steps a mast out past
    any carriageway, `o.onRoad`) and the back-out reversing at 6 m/s into
    the queue (now at a walking pace). jcttraffic, base -> this: seeded 3
    hits / 12 crashes -> 3 / 0, unseeded 3 / 3 -> 0 / 0; at signal 384, 2 x
    300 s: 21 hits -> 9 (sig-384 site 0); at 776: 9 hits + 1 crash -> 0.
    trafficbench hashes change at the city sites (meant: these change
    traffic) and match base at the freeway ones; rail on = rail off;
    hwytraffic 7 hits / 0 crashes = base. A U-turning car at the all-way
    by (-2995, -1212) still bumps one turning right at a crawl (3 hits):
    not an all-way at all, a gap in the graph ("Follow-ups after v55").
  - **Grass hairlines across a road** (world.js meshRoad): two strips
    meeting end to end at a node with no mouth (OSM's way split) each kept
    their own 0-3 cm bias, a step with nothing drawn in it -- from the low
    side the grass 0.3 m under the road, as a line (Galt, (11992, 8802),
    just inside a chunk line: its node's chunk owned neither edge, so the
    node was never meshed either). The bias fades to 0 over 3 m into such a
    node (`biasT`, the paint too), and a node is meshed by its own chunk
    whatever owns its edges.
  - **Garage doors over windows** (world.js `_garageSpot`): the siding is a
    composed ~11 m elevation (window at u 0.13-0.40, front door 0.595-0.86,
    frames and sills included). The door slides up to 1.6 m to cover an
    opening whole or miss it; else it keeps its end and a wall-coloured
    infill closes the openings it cuts. Beechwood/Uptown/Fairview chunks:
    3426 doors, 1039 slid, 1700 with infill, none lost (`cityStats.garages`).
  - **Fences through trunks** (rural.js `clear(x, z, pad)`, trees.js): the
    keep-clear zone ended 0.1 m inside the field-edge fence line, so a tree
    could stand on it; trees now keep a 1.2 m pad past the zone, fencerow
    trees start 0.6 m further out. `tools/kw/fenceprobe.js` (panel to trunk
    within r + 0.6 m, six rural sites): 2 -> 0.
  - **Stop bars in the intersection** (junctions.js `setback`,
    `barAcross`): a bar that lies across another street's lanes (centre or
    either end of its span) steps back along its arm, up to 12 m; if it
    cannot clear (an approach that starts inside the intersection: the far
    carriageway's node of a divided road) it is not painted (teeth too).
    The AI's stop line moves with it. `tools/kw/stopbars.js`: painted bars
    across another street 342 -> 0 (173 moved clear, 169 dropped). The 169
    are painted since: "Follow-ups after v55".
  - **Trail benches are solid** (kwnature.js): a landmark solid each (seat
    and back as one box, knee-high to the back's top), added with
    `city.addLandmarkSolids` (indexes only the new ones) when bikes.js asks
    for the bench spots: 988 benches; a sedan at 8 m/s into one stops at
    1.6 m/s.
  Phone (AUTO_PHONE=1, GPU), base -> this: spawn 218/1084k -> 219/1085k
  (traffic); Galt 197/716k =; Beechwood house 202/1080k =; Kitchener
  station 374/1579k -> 376/1575k; 0 exceptions. drivetest identical;
  ionprobe, funprobe PASS.
- **Follow-ups after v55** (docs/followup55-*.jpg, before over after): the
  three junction leftovers v55 named, each traced to its root.
  - **Every stop line on its approach** (junctions.js `chain`, `lineAt`,
    `setback`, `noApproach`, matchSignals). The 169 bars v55 stopped
    painting were not approaches that start inside the intersection: 147 of
    them had a DEGREE-2 node 6-15 m out (OSM splits a way at a crosswalk, a
    lane or name change, where a roundabout entry leaves its splitter
    island), and the setback was clamped to the last EDGE (`e.len - 3`),
    short of the crossing street's kerb. An approach is now a chain:
    upstream through degree-2 nodes (not into a control, a ring, a deck or a
    hairpin) to 45 m; the line is measured along it (the same measure as a
    car's route distance, so junctionStop is unchanged) and painted, signed
    and stopped at where it lands (`A.at(o)`). It may go to 3 m short of the
    junction the chain starts at, 0.5 m short of anything else. The junction's
    own crosswalk counts as before on the last edge (within 14 m of the
    mouth), up the chain only at the mouth (+6 m): a roundabout's
    splitter-island crossing a car length back is not the entry's, its yield
    line stays at the ring. If the line behind a crosswalk is across another
    street wherever it goes, it goes in front where it is clear. The rest:
    a signal whose OSM nodes are on one carriageway now takes in the
    junction an arm starts at when no line fits between them (16;
    `stats.sigAbsorbed`), an arm whose chain leads back into the signal's
    own nodes is not an approach, nor is a dead-end stub lying inside the
    crossing street. `barAcross` uses the module's own 32 m grid
    (`edgesAround`, now with graded edges; callers that must skip them do):
    edgesNear lists whole chunks by edge centre and missed long edges.
    `tools/kw/stopbars.js` (runs on master too): 8292 approaches, 0 across,
    169 not painted -> 8288, 0 across, 2 not painted (both arms leaving a
    Y with a ramp a few metres back: sig 496 at (12673, 8739), rb entry 215
    at (2749, 9086)). Of the bars master did paint, 237 moved >= 0.3 m: on
    master the edge clamp had put them on or in front of their crosswalk's
    stripes (stop at (-2084, 1575): 5.3 m with the crosswalk at 6.6 m; now
    9.2 m, behind it), or the merged slivers below lengthened their edge.
  - **The "all-way" at (-2995, -1212) was a gap in the graph**
    (tools/kw/build_roads.py `merge_slivers`, roads.bin rebuilt; see "What
    is different from Seattle"). OSM's Union St E has a 3.4 m way there;
    the importer dropped segments under 4 m and with it the joint, leaving
    two dead ends 3.4 m apart: cars from each side U-turned there into each
    other. 616 such places map-wide; merged, not dropped. The street's
    trees and hydro line now run through (followup55-union-gap.jpg).
  - **No-exit streets** (traffic.js `noExitTraps`, `CUL_MAX` 350 m). Stop
    5558 (Braun St onto Linwood Ave) had nothing wrong with it: Linwood is a
    real dead end past it (a path beyond), and routing took it straight on
    as often as not, so cars queued at its end, U-turned into one another,
    wedged and backed out. Per directed edge, propagated back from the dead
    ends: a trap once every legal way on from its end (bar back along
    itself) is one, with the longest drive to the turn. pickNextEdge scores
    a two-way trap under 350 m -6 (taken only when nothing else is legal),
    and no car spawns heading into one. It also catches Union St E
    northbound at Willow St (closed beyond for its rebuild: Willow one-way
    in) where the cars that did turn into the 18 m stub U-turned on the one
    waiting at its stop line. 6918 trap directions, 4733 under 350 m; ~17 ms
    on the desktop, kept by the boot cache (`traffic:noexit`). jcttraffic at
    those two (seeded, 600 s each): master 41 hits (Linwood) + 21 hits / 12
    recycled (Union) -> 0 + 0 / 0. **Approximate:** a whole pocket under
    350 m that is all no-exit (Braun St / Linwood Ave beside the railway)
    now gets no traffic at all -- nothing spawns into it, nothing turns in --
    where life has a resident's car now and then.
  - **Verify**, master -> this, identical commands: jcttraffic seeded 3 hits
    / 0 crashes / 1 recycled -> 0 / 0 / 1, unseeded 0 / 0 / 8 -> 0 / 0 / 7;
    hwytraffic seeded 5 / 0 and unseeded 7 / 0 both = master; trafficbench
    (`window.__noRail=true`): 401-hespeler = master; the city sites change
    (uptown-king, sig-1644, allway-28, rb-3lane: stop lines, the graph, the
    routing), and so does pkwy-fairway, whose only difference is a city car
    master spawned heading into a 17 m dead-end stub of King St E beside the
    Conestoga (`dump: 299` shows car 206: master's civic on edge 16168, this
    build's next spawn on the freeway instead; the freeway cars around it
    then differ by its presence). AUTO_GPU=1 funprobe ALL OK; phone boot 0
    exceptions, spawn 178 -> 177 draws (1114k -> 1111k tris).

- **The residential street from the driver's seat** (docs/streets-*.jpg,
  before over after: Doon South, Activa Ave, Breithaupt St). Surveyed at
  street level in Westmount, Belmont, Mt Hope/Breithaupt, Laurelwood, Doon
  South, Huron Park, Laurentian West, Galt and Hespeler. What changed:
  - **No paint on a residential street** (world.js `unpainted`: an urban
    `res` edge with hw <= 6.5 -- wider ones are OSM's collectors -- carries no
    centre or edge lines, near (meshRoadMarks) or far (farRoadSteps flags)).
    KW paints none on a local street; the yellow dashes were the loudest
    "American suburb" tell. Country roads keep theirs.
  - **Sidewalks per side, from OSM** (`tools/kw/build_sidewalks.py` ->
    `data/sidewalks.bin`, 50 KB): KW maps ~2,600 km of footway=sidewalk as
    separate ways. Each street edge's two sides are sampled every 5 m for a
    parallel sidewalk within hw-1.5..hw+10 m: none (lawn to the kerb), against
    the kerb, or behind a grass boulevard (median > 1 m behind the kerb line);
    where none is mapped within 120 m the road's `sidewalk=` tag decides, else
    UNKNOWN keeps the old full-width pavement. 4 bits an edge (`e.swk`,
    citygen), checked against roads.bin's edge count and a+b sum -- **re-run it
    after build_roads.py** or the game ignores it. Drawn in meshRoad's pavement
    loop as bands of the existing strip: the walk 1.5 m in the road material's
    pavement mode, the lawn in its grass mode (`SURF_GRASS`, the ground's own
    tint). The strip's width, grading, peds and kerb are unchanged; no draws.
    Res: none 35 %, kerb 5 %, boulevard 46 %, unknown 14 % (rural edges count
    as none).
  - **Driveways reach the street.** Garage driveways run to the kerb (up to
    14 m, was 8) in ground-following <= 3 m pieces (`_driveStrip`), and
    `_driveApron` climbs them over the pavement strip (WALK_Y, 0.52 m over
    the ground) to the kerb -- the lawn boulevard otherwise left each one
    ending at a grass bank. **Side driveways** (`_sideDrive`) for garage-less
    houses 6-17 m wide (the 1950s bungalows): down whichever side yard is
    clear of every other footprint 3.5 m out, the car parked beside the
    house. Outside `OLD_CORES` a 7 m house gets its single garage (was
    9.5 m: the 2000s subdivisions' narrow lots). `cityStats.drives` counts
    (Westmount ~700 garage + ~530 side driveways in its near chunks).
    The Region's carts and the net stand on the strip at the kerb end now.
  - **Cars in the driveways: src/kwdriveway.js.** House code leaves records
    (`userData.dcars`: x, y, z, heading, type, colour seed): a car in 3 of 4
    driveways, a second on a double one time in 3, one in 6 backed in, none
    where the ground falls > 0.3 m under it. `DrivewayCars` keeps those within
    90 m (phone) / 140 m and pushes them into **traffic.decor** -- drawn
    through the far LOD's InstancedMeshes like the drive-thru lines (and,
    since the scenery-cars entry below, the nearest in their detailed model):
    no draws of their own, never in traffic.cars, trafficbench hashes
    unchanged. Types: the `MIX` there (below). Solid for the player (keepOut, in
    a car or on foot). While paused (harness views) `posed()` chooses round
    the camera and refreshes the far-LOD frustum. `window.__noDriveCars`
    before boot turns it off; `__dbg.dcars`.
  - **Canada Post.** `data/postboxes.json` (same script): OSM's 63 community
    mailboxes and 280 red street letter boxes, each stood at its point, turned
    to its nearest street, lifted onto the strip if it is on it
    (`_postBoxes`, `_cmb`, `_letterBox`). Procedural community mailbox banks
    (1-3 grey units with the red mark, on a pad on the boulevard, ~1 per
    200 m of kerb) only inside `NEW_SUBDIVS` -- **a judgement list** of the
    post-1985 subdivisions (Laurelwood, Clair Hills, Westvale, Eastbridge,
    Williamsburg, Laurentian West, Country Hills, Huron Park/South, Doon South,
    Deer Ridge, Lackner Woods, Hespeler SE, Saginaw...); OSM has no era data.
  - **A residential kerb is hydrants and signs.** meshProps' small clutter
    on a `res` edge drops the parking meters, litter bins, newspaper boxes
    and bollards (downtown's); nothing stands on a driveway apron
    (`_onApron`), lamps included.
  - Phone (AUTO_PHONE=1, GPU), master -> this, player view after
    `player.respawn` there (draws wobble +-3 with traffic): spawn 179/1134k ->
    178/1151k; Westmount 147/940k -> 143/945k; Mt Hope 251/1409k ->
    253/1453k; Doon South 107/857k -> 101/887k; Activa 97/918k -> 88/832k;
    Galt 140/1106k -> 140/1111k. `tools/kw/streetdraws.js` (VIEW_PROBE_FILE)
    attributes the scene pass at six driver's-seat cameras. trafficbench
    (rail off) hashes identical to master, funprobe 63 ok / ALL OK on both,
    drivetest output identical, 0 exceptions.
  - **Approximate / not done:** NEW_SUBDIVS radii; the far LOD car models
    are the clustered ones (fine past ~10 m, blobby closer: done in the
    scenery-cars entry below). The next entry did the boulevard trees, the
    walkers, the lawn corners and the hydro.

- **The residential street by era: poles, lights, trees, walkers, corners**
  (docs/streets-era-old.jpg, streets-era-lights.jpg, streets-corners.jpg:
  master left, this right). v59's leftovers.
  - **`streetEra(x, z)`** (world.js): 0 pre-1970 = `OLD_CORES` + `OLD_HOODS`
    (new judgement list round OSM's place nodes: Westmount, Belmont Village,
    Northdale, Victoria Hills, Forest Hills -- the garage rule still reads
    OLD_CORES only); 2/3 = `NEW_SUBDIVS` (post-1985; now also Laurelwood's
    west end to Erbsville Rd); 1 everything else (1970-85). OSM has no era
    data (45 dated buildings in the box); a top-down render of the
    res/st edges coloured by era was the check. Era 0 side streets carry the
    overhead hydro (`hydroEdge`), wood poles with the cobra head on a davit
    and no street lights of their own, as before. Others get `_eraLamp` in
    meshProps' old lamp slot (h < 0.42): **1** a grey direct-buried pole
    (no base plate) ~8 m, straight bracket, cobra head; **2** a black fluted
    post ~4 m with a post-top coach lantern (Waterloo's west side and
    Eastbridge: NEW_SUBDIVS centres with x < -5000, and Eastbridge's);
    **3** a black ~6.6 m pole with an upswept davit and a flat LED head
    (Kitchener, Cambridge). Arterials keep their hydro. Seattle's tapered
    mast with the cranked arm is gone from residential streets. One light per
    18 m of a chunk (two edges' slots fell 4 m apart across a node). All into
    the chunk's flat/glow builders: no draws. Which style each subdivision
    has is a judgement too (no photo survey per street).
  - **Where things stand on the strip, by the side's sidewalk** (`swk`):
    a light at hw + 0.55 in a boulevard, + 2.05 behind a kerb walk, + 0.8
    with none, + 1.4 not known; a hydro pole at `POLE_OFF` [0.8, 2.05, 0.55,
    1.5] the same way. A pole's lattice spot that lands on a driveway apron
    slides up to 5.5 m along the kerb; a span is strung back across a node
    only to an edge whose poles stand on the same line (`poleSwk`).
  - **Builder.box's rotation sense, again:** the hydro crossarm and davit,
    and v59's community mailboxes and letter boxes, used `atan2(x, z)` for a
    box whose length is along (x, z) -- mirrored, so on a diagonal street the
    crossarm ran skew and the mailbox was turned off the kerb. A box's local
    z is along (x, z) with `atan2(-x, z)`.
  - **Boulevard trees stand in the boulevard** (trees.js): on a `swk` 2 side
    a res/st street tree is planted 0.6 m off the kerb line, in the 1.1 m
    grass band, not 4.1 m out on the front lawn; clear of the kerb furniture
    slots, driveway aprons (1.2 m), the hydro lattice (`world.hydroPoleNear`:
    from the edge alone, so a mid-ring build plants the same trees) and, in a
    near build, any solid within 0.9 m (a slid pole, a light). Its trunk's
    solid is capped at 0.28 m (`plant(..., rMax)`). Every street tree now
    keeps 1.6 m off a hydro pole's lattice spot on its side (70 trunks stood
    on poles in the probe's sites before). `cityStats.boulevardTrees`.
  - **Pedestrians walk the walk** (peds.js `walkOff(e, sg)`, `SWK_OFF`):
    the middle of OSM's walk -- 0.75 m past the kerb (kerb walk), 1.85
    (boulevard) -- or the road's edge, 0.35 m in from the kerb, where a side
    has none (people walk in the street there; standing cars are stepped
    round by `_avoidCar`); 1.4 not known. Spawning, the walking line, a
    reanchor and planNode's corners and crossings (`armOff`: each arm's line
    on its own side) all use it. `tools/kw/pedline.js` (runs on master too):
    no-sidewalk sides master 1.41 m past the kerb, 100 % on the lawn -> this
    -0.31 m, 1 %; kerb walks 1.40 -> 0.75 m, 98 -> 100 % on the walk;
    boulevards 1.41 -> 1.86 m (master's line was the boulevard's edge).
  - **Lawn corners** (world.js meshJunction): citygen's junction pieces carry
    `sd` (arm i's edge and +p side, arm i+1's edge and -p side); each corner
    quad in the half belonging to a side with `swk` 0 is drawn as lawn (the
    road material's grass mode, the ground's tint), the other half as before.
    Heights are unchanged (nodeSurface still answers WALK_Y there).
  - **Verify** (all sequential, never two harnesses at once):
    `VIEW_BOOT_JS='window.__logSolids=[]' VIEW_PROBE_FILE=tools/kw/poleprobe.js
    AUTO_PHONE=1 node tools/kw/kwshots.mjs /tmp/x` streams 18 residential
    sites and checks every pole and light (world.js `logSolid`; trees.js logs
    its near-build trees): 4776 poles, 470 lights, **0 in a lane**, 0 with a
    trunk on them, 10 on a driveway (0.2 %: the apron belongs to a house in
    the NEIGHBOURING chunk, which `_onApron` -- per chunk -- cannot see).
    Phone (AUTO_PHONE=1, GPU), master -> this: spawn 177/1146k -> 176/1135k;
    air-uptown 285 -> 287, air-river 209 = , air-galt 145 = , air-region 223
    -> 220; streetdraws westmount 290/1622k -> 293/1629k, mthope 260 -> 262,
    breithaupt 318 = , doonsouth 188/1310k -> 189/1295k, activa 106 -> 107,
    galt 133 -> 134 (+1 everywhere is a walker's SkinnedMesh: the crowd
    stands elsewhere now; triangles within 1 %). trafficbench (rail off,
    phone) hashes identical to master at all six sites; AUTO_GPU=1 funprobe
    63 ok / ALL OK; 0 exceptions.
  - **Approximate / not done:** the era lists are judgement circles, and a
    1970s pocket inside an OLD_CORES circle gets poles; the boulevard is the
    strip's 1.1 m (the pavement strip is 2.6 m wide on every res street, so a
    real 2-3 m boulevard is drawn narrower); a light or pole can still stand
    on a driveway whose house is in the next chunk; a walker on the road's
    edge steps round parked cars but does not step up onto a walk where one
    starts mid-block; the slid poles' spans may meet a pole in the next chunk
    that did not slide (a driveway only one chunk knows).

- **Scenery cars up close: the detailed model** (docs/scenery-cars-near.jpg:
  master left, this right; bottom row the swap at 40 m). The driveways' cars
  and the drive-through lines were drawn with the far LOD's clustered model
  at every range: blobby next to a traffic car at 10 m.
  - **Traffic does not batch its near cars**: each is its own paint / trim /
    matte meshes, 3 draws (+3 in the shadow pass within SHADOW_NEAR). So the
    scenery cars do not join traffic's near cars; they get their own LOD:
    **vehicles.js `nearLod(type)`** is the type's own detailed parts (paint,
    trim with the wheels baked, matte -- every vertex traffic draws) merged
    into ONE geometry over the far LOD's material (`lodA`/`lodG` per vertex,
    the instance colour on the paint only). One InstancedMesh per type
    (`sceneryCars`, traffic.js `growNear`), casting the sun's shadow as a
    traffic car does.
  - **traffic.js `updateFarLod`**: the scenery cars in the frustum within
    `DECOR_NEAR` of the CAMERA (40 m phone / 55 m desktop), the nearest
    `DECOR_CAP` (10 / 18), go to their type's near mesh, the rest to the far
    LOD as before. Same matrix (x, y + pivotY, z, yaw), same colour, same
    material, so the swap changes only the mesh. `traffic.sceneryTypes(list)`
    (main.js, right after the TrafficSystem) builds the types' near and far
    LODs at boot, **before a phone drops the vehicle arrays**
    (`dropVehicleArrays` drops the near geometries too once uploaded; ~0.8 MB
    of GPU buffers per type, ~5 MB for the phone's six). Nothing here reads or
    writes traffic.cars, its RNG or Math.random.
  - **The mix** (kwdriveway.js `MIX`, `sceneryType(u)`): Canadian
    registrations -- phone: crossover 33, suv 13, suv3 7, pickup 15,
    compsedan 21, minivan 11 (six types: every type in view is a draw, near
    and far); desktop adds jeep, pickupcap, sedan, hatch, evy, wagon, civic.
    world.js `_driveCars` stores the draw as a byte (type slot of the record);
    drivethru.js's lines take the same mix (were crossover/suv only).
  - **Differences from a traffic car up close**: glass is the far LOD's opaque
    sky-folded glass (no see-through), no contact-shadow blob (they cast the
    sun's shadow), plates are plain plate colour, no dents.
  - Phone (AUTO_PHONE=1, GPU), master -> this: spawn 176/1135k -> 177/1141k,
    air views +1..+6 draws (more far types), 0 exceptions;
    `tools/kw/streetdraws.js` westmount 297 = , mthope 266 -> 267, breithaupt
    323 -> 320, doonsouth 192 -> 194, activa 110 -> 109, galt 137 -> 138
    (`sceneryCars` 1-3, `farTraffic` down to match); driveway close-ups
    +2..+4. Live (respawned there, unpaused): 1-4 near cars, +1..+3 draws in
    the shadow pass (one per near type; `tools/kw/scenerycars.js`). trafficbench (rail off, phone)
    hashes identical to master at all six sites; AUTO_GPU=1 funprobe ALL OK
    (dthru: the line's cars detailed).
  - **Approximate / not done:** the near/far swap at 40 m is visible in a
    telephoto (wheels and glass go blocky) though not at the game's 62 deg;
    the far scenery cars still cast no shadow, so a car's shadow appears at
    the swap, as traffic's does at SHADOW_NEAR; the phone's type list is six
    of the thirteen.

- **The arterials from the driver's seat** (docs/arterial-divided.jpg,
  arterial-twoway.jpg, arterial-stops-lights.jpg: master left, this right).
  Surveyed at 13 driver's-seat cameras (`VIEWS=tools/kw/arterialviews.json`
  with `VIEW_PRE="$(cat tools/kw/artseat.js)"`: `__seat(street, x, z, u,
  ahead, rev, up, tup)` puts the camera in traffic's own lane `u` on the
  named street) on Fischer-Hallman, Homer Watson, Hespeler, Victoria,
  Weber N/E, University W, Ottawa N, King N, Highland, Franklin, Ira Needles,
  against OSM's tags. What read wrong: a 12 m divided carriageway with no
  lane line though traffic drives two lanes on it, a 20 m two-way road with
  one lane a way and a broken yellow dash, the wheel-track polish across
  the lane lines, no bike lanes, the median the bare ground 30 cm under the
  road (cars over it at 52), a hydro line IN the median, no bus stops.
  - **`src/arterial.js` is the one layout**, read by traffic.js (where a
    car drives) and world.js (where the paint goes), so they cannot
    disagree: `edgeFlow` and `oneWaySpan` (laneLatU's one-way computation,
    moved verbatim -- trafficbench hashes identical with the data off),
    `twoWayLayout(e)`, `medianGaps(city, e)`, `alBike`. **Data:**
    `tools/kw/build_artlanes.py` -> `data/artlanes.bin` (2 bytes an edge,
    checked against roads.bin like sidewalks.bin -- **re-run after
    build_roads.py**): lanes each way (`lanes:forward` / `backward`, or an
    even `lanes`; **turn bays are not lanes** -- only `turn:lanes:*` entries
    that go straight on count, else Victoria at Frederick was 4 + 2 for
    30 m and the centre line jogged 5 m), the two-way left-turn lane
    (`lanes:both_ways=1` + `turn:lanes:both_ways=left`), a painted bike lane
    per side (`cycleway*=lane`). citygen's `e.al`. 93 km of art + 16 of st
    are two-way multi-lane, 16 km TWLTL, ~290 km have a bike lane.
  - **Two-way multi-lane traffic (deliberate):** laneLatU on a two-way edge
    with `twoWayLayout` lays `nP` / `nM` lanes of `w` (2.9-3.7 m) out from
    the centre `m` (the lane block centred in the kerbs: 0.5 m gutter, 2.1 m
    with a bike lane; `c0` 0.2 double yellow, 1.75 TWLTL), lane floor(u n)
    counted from the centre. A straight-on car keeps its lane
    (nearestLaneU), a turn onto one takes the kerb lane (right) or the
    inner lane (left), and the city lane-merge yield (`cityMerges`) covers
    these edges. No kerbside parking in a bike lane, on a multi-lane
    two-way edge or against a median (kerbSlots).
  - **Paint** (world.js meshRoadMarks): one-way art/st -- broken white
    3/6 m lines at oneWaySpan's lane boundaries, a YELLOW left edge line on
    a divided road's carriageway; two-way multi-lane -- double yellow, or
    the TWLTL's solid + broken yellow each side and pairs of opposed left
    arrows every 45 m (`TWLTL_ARROW`), broken white between lanes; bike
    lanes -- the solid white line at the traffic lanes' edge (no edge line
    then), Ontario's bicycle + diamond every 60 m (`BIKE_MARK`, `markAt`).
    Dashes and marks are phased off the street's own direction (`proj`), so
    they run on across OSM's edge splits. **Asphalt strips** (`artStrips`):
    one cell per lane on its own stretch of the texture between the
    polished tracks, as freeways (`laneStrips`). `cityStats.roadMarks`.
  - **Medians** (meshRoad's pavement loop): a one-way art/st side whose
    opposing carriageway's kerb is under two pavements away is the
    median's half, kerb to midline at WALK_Y (roadLift already said so):
    concrete under `MEDIAN_CONC` 3.2 m (Hespeler, University, King N),
    lawn wider; no verge.
  - **Hydro and lights** (hydroEdge, `_artLights`, `_eraLamp` 4): a divided
    road's carriageway whose pole side is its median strings no line (both
    carriageways carry the name, so one line stood in the median); arterials
    through the post-1985 subdivisions (`streetEra` >= 2) have none. Those
    get galvanised ~10 m davit standards with LED heads on a 38 m lattice
    down the street (`ART_LAMP`; staggered on a two-way road, the outer kerb
    of a carriageway), which `hydroPoleNear` also answers so trees keep off.
    An arterial's slot props (hydrants...) go to the outer kerb of a
    carriageway; the generic Seattle bus shelter on arterials is gone.
  - **GRT stops** (`tools/kw/build_grtstops.py` -> `data/grtstops.json`,
    `world._grtStops`): OSM's 2,272 stops at the kerb of their nearest
    street, the marker (blue band, orange local / green iXpress, white
    strip; GRT's site: orange local, green express), and the glass shelter
    behind the walk with a bench where shelter=yes (498), solid. No draws.
  - **Verify** (sequential; master in a detached scratchpad worktree, same
    commands): phone boot 0 exceptions, spawn 175 -> 178 draws (spawndraws,
    two runs each: master 178/175, this 177/176; the chunk group 55 draws
    both, +17k tris), 1132k -> 1156k tris; air views +0..+5; the 13 arterial
    cameras (phone) draws equal or -5, tris +7..+22k. trafficbench (rail
    off, phone): uptown-king and 401-hespeler = master; sig-1644,
    pkwy-fairway, allway-28, rb-3lane change -- meant: each has two-way
    multi-lane arterials (Weber, King E, Ottawa, Courtland, Fairway: 46-206
    such edges within 600 m) where cars now use both lanes, and kerbs that
    lost their parked cars. jcttraffic seeded 0 hits / 0 crashes / 1
    recycled = master; unseeded 0 / 0 / 6 -> 0 / 0 / 9; hwytraffic seeded
    5 / 0 = , unseeded 7 / 0 -> 6 / 0; at eight arterial sites (Victoria,
    Weber N/E, Ottawa, Hespeler's TWLTL, Franklin, Fischer-Hallman, King E;
    seeded) master 0 hits / 0 crashes, this 1 / 1: at Weber E's site a
    sedan off the slip lane (1278, 1647) into King St E's one-way
    carriageway hit a bus stopped in it -- neither edge's lanes changed (a
    ramp merging into a city carriageway is not in cityMerges); the run
    differs because the traffic round it does. (Before the turn-bay rule
    Victoria at Frederick had 1 hit: two lanes into one.) poleprobe: 0 in
    a lane, 0 trunks on a light (`lamp4` 249 at the default sites, 264 at
    nine arterial ones); stopbars 8288 / 0 across = master; AUTO_GPU=1
    funprobe ALL OK.
  - **Approximate / not done:** (turn bays, lane arrows, lane choice and
    median noses: done since, "Lane choice and left-turn bays" below)
    one-way carriageways keep traffic's own lane count (from the width),
    not OSM's; the double yellow on a 2-lane arterial stays a broken
    yellow; the GRT marker has no stop number or logo lettering; shelters
    are one design; light standards on medians (Homer Watson's) are not
    drawn.

- **The authenticity pass** (docs/authentic-*.jpg: master on top, this
  below). Surveyed from the driver's seat at 21 cameras (Mt Hope, Breithaupt,
  Westmount, Laurelwood, Activa, Doon South, Fischer-Hallman, Weber N,
  downtown King St, Uptown, a plaza, Hespeler Rd, Galt, a concession road,
  the 401, the Conestoga). Ranked by how much each broke "this is KW":
  (1) every gabled house had a grey cardboard triangle on each end; (2) a
  residential street had no sign an Ontario driver knows -- the kerb's "sign
  on a post" was a blank grey plate, and nothing said 40; (3) a bright
  polished stripe down the centreline of collectors; (4) the old cores'
  brick houses mostly porchless boxes. Done, all into the chunk's flat
  builder (no draws):
  - **Gable ends are wall** (world.js meshGable's `wall`): the triangles
    were the roof's shingle colour, out on the eaves' overhang line. Now the
    gable is the wall's colour (its tint x the cell's mean x 0.85) on the
    wall's own plane, the slopes run 0.45 m past it, a 0.2 m barge board in
    the trim colour down each rake, soffits under the overhangs; the roof
    slab stops at the gable walls (it was a 0.35 m shelf across them).
    Dormers too. Flat colour, not the brick/siding texture: it reads as the
    siding an Ontario gable often has over brick.
  - **Porches in the old cores** (`porchShare`): 80 % of houses inside
    OLD_CORES (pre-war Kitchener, Uptown, Galt, Preston...), 42 % elsewhere
    as before. The garage and bay-window rules read the same share.
  - **The 40 km/h neighbourhood gateways** (streetsigns.js `regSign`,
    world.js meshProps `regAt`). Kitchener (council 2021, every
    neighbourhood by the end of 2023, 1,000+ signs) and Waterloo (2023-25,
    40 on neighbourhood streets) post the limit only at the way in, as O.
    Reg. 615 s. 5.1.1 (2018) prescribes: the Rb-1 MAXIMUM 40 km/h, an AREA
    tab, and BEGINS under it; the same with ENDS for the way out (St.
    Catharines' wording; Kingston, Ottawa alike). Where a residential edge
    meets a collector or arterial in Kitchener or Waterloo (streetsigns'
    `muniAt`), 11 m in: BEGINS on the right going in, ENDS on the other
    kerb facing the traffic coming out (one-way streets: their way only).
    **No-parking signs**: a residential kerb's blank plate is Ontario's
    no-parking sign (red ring and slash over a black P, an arrow left /
    right / both), facing its side's traffic, in every municipality. Posts
    and plate backs in the chunk's flat mesh, solid (addObstacle, knock
    down); the faces are streetsigns.js lettering from THREE shared atlas
    slots (`R|max`, `R|tab`, `R|np`), each sign laid from cells of them as a
    GRT stop number is (a face's `cu`), within 110 m. `setExtra` now takes a
    tag (GRT's 'grt', these 'reg') so both drawers keep their lists a chunk.
    `cityStats.regSigns` counts them.
  - **Wheel tracks in the lanes** (meshRoad `uOf`): a street with no
    artStrips laid the 9 m road tile from its kerb, so its two polished
    tracks fell wherever the width put them -- one down the centreline of
    a 12-14 m collector. The tile is centred on the centreline now (tracks
    at +-2.2 m); a 9 m street is unchanged.
  - **Cost** (AUTO_PHONE=1, GPU, seedrandom, a frustum census of the
    world's chunk meshes, master -> this): chunk draws identical at all 10
    cameras (country 15, gateway 70, Mt Hope kerb 71, Waterloo gateway 52,
    Activa 55, Doon South 64, Uptown 62, downtown 58, Westmount 66); chunk
    triangles +2-7 % (37k = ; Mt Hope 791k -> 832k; Uptown 546k -> 573k;
    Westmount 712k -> 742k: the gables' +10 triangles a house); the scene
    pass's draws differ only by the seeded crowd's +-3. trafficbench (rail
    off, phone): all six hashes = master. 0 exceptions.
  - **Sources:** kitchener.ca "Kitchener implements 40km/h speed limit in
    residential neighbourhoods"; CTV Kitchener (Waterloo council, 2022);
    engagewr.ca speed management (Waterloo's phases, 2023-25); O. Reg.
    301/18 (amending Reg. 615: s. 5.1.1); stcatharines.ca ("Maximum 40 Area
    Begins / Ends"); getinvolved.cityofkingston.ca.
  - **Approximate / not done:** the AREA / BEGINS tabs are drawn black on
    white (the regulation's figures were not readable; one alt text says the
    AREA tab is yellow on blue -- check a photo); Waterloo's Uptown ward is
    30, drawn 40; Cambridge's neighbourhoods get no gateways (no source
    found); no school-zone 30 signs or flashing beacons; arterial and
    collector kerbs keep the old blank plate (their posted limits are OSM's
    and only g2.json carries them); the gable is a flat colour; found but
    not done: hydrant colours (no source for KW's), the old cores' houses
    are still two-storey boxes where many are a storey and a half with a
    steep front gable.
- **Lane choice and left-turn bays** (v62's open items; docs/lanes-*.jpg:
  master left, this right). Every rule is one both traffic and paint read,
  so the paint never shows a rule traffic ignores.
  - **Lane choice in town** (traffic.js `cityLaneDecide`, every `LC_TICK`
    0.4 s for a city traffic car; freeway edges keep fwyDecide). The route
    is planned `LC_PLAN` 160 m ahead; `nextTurn` finds the first turn on it
    (`turnAt`: to the first entry out of a signal's box; a bend, or the
    straightest way on where the street itself bends, is straight on). A
    left wants the leftmost lane of travel (`laneIdx`: lanes counted from
    the left; -1 the bay), a right the kerb lane. Not in it: the car
    SIGNALS (`lcSigOn`, `LC_SIG` 1 s, `lcSigShift` where it is going) --
    `COURTESY_P` 70 % of drivers behind in that lane treat it as a leader
    where it is going and ease off (driveTraffic's scan) -- then moves one
    lane once rolling (> 1.5 m/s) into a gap that passes fwyLane's tests
    (`cityLaneClear`: nothing alongside, the leader there far enough, the
    follower not asked to brake past LC_SAFE), by `cityChangeLane`: entry 0
    re-laid with an lcShift (the freeway's smooth change), the rest of the
    route RE-PLANNED OVER THE SAME TURNS (`routeExtend(v, forced)`; a
    re-pick would re-hash v.x and could choose another turn). Still not in
    it `LC_LATE0 + LC_LATE_T x speed` m short of the junction: `missTurn`
    cuts the route there and pickNextEdge scores -8 every exit there this
    lane cannot make (`lcMiss`, once per junction) -- no turn is made across
    a lane. (The signal is drawn since: "Vehicle lamps" below.)
  - **A quarter of drivers turn at a signal** (pickNextEdge `atSig`: dot x
    1.2 + hash x 2.5 there, not dot x 2 + hash x 1.1). Before, a car never
    turned where it could go straight on: the jcttraffic sites saw 19 lefts
    at signals in 1440 s, the eight arterial sites none.
  - **Left-turn bays** (arterial.js `markBays`, called by prepJunctions;
    `alBay` from tools/kw/build_artlanes.py, byte 1 bits 4-5: a way's
    `turn:lanes:forward / backward` with a left-only lane): on each signal
    approach OSM maps a left lane on (`A.left`), the two-way art / st edges
    running into it that carry the bay that way, upstream through degree-2
    nodes, `BAY_MIN` 18 m to `BAY_MAX` 150 m; `e.bayP` / `e.bayM` = { A, d0,
    start, len }. 334 approaches, 713 edges, 25 km. twoWayLayout gives the
    bay a lane of its own beside the centre (`yP` / `yM`, `oP` / `oM` lanes
    laid out a side; the lanes stay centred in the kerbs, so through lanes
    flare outward where it opens; a bay replaces a TWLTL; the layout now
    also exists for 1 + 1 roads with a bay; no room = no bay there).
    `twoWayLaneOff(L, sign, -1)` is the bay, a lane fraction u < 0 means it.
    **Traffic:** `bayRule` (routeExtend): when a planned left out of the
    bay's signal is appended and the entry before the bay's run is in the
    inner lane, the run's planned entries are re-laid in the bay -- the jog
    at the node where it opens is the car moving into it; a car already on
    a bay edge moves in by cityLaneDecide. nearestLaneU never maps into the
    bay, so through cars stay out. **Paint** (world.js `_bayMarks`): the
    solid white line between bay and through lanes, a 15 m diagonal taper
    out from the centre line where it opens, Ontario's left arrow
    (`TWLTL_ARROW`) 6 m behind the stop line (and 25 m further back on a
    bay over 50 m), and the through lanes' arrows beside it -- straight
    (`THRU_ARROW`), straight-or-right in the kerb lane (`THRU_RIGHT_ARROW`):
    exactly the moves traffic makes from them. The stop bar starts at the
    layout's centre line; the signal's left head hangs over the bay.
    **Import:** build_artlanes.py also reads a side's lane count off its
    turn:lanes where `lanes:forward / backward` are missing (`lanes=3` +
    `turn:lanes:forward=left|`), only where `lanes` leaves the other side a
    lane.
  - **Opposing lefts one at a time** (since replaced by `leftClash`: "Lefts
    whose ways meet, and the gridlock rule" below).
  - **Slip-lane merges** (traffic.js `slipMerge`, from junctionStop): a car
    on a ramp whose route joins a CITY street at a merge (cos >= 0.3) with
    no control there stops short of the join while any car whose route
    comes through that node by another way -- into its lane, or across it;
    not the other way down a two-way street -- would get there within
    `SLIP_GAP` 3 s of it (creeping as at a line; ctlHold). The v62 crash at
    (1278, 1647): a sedan off the slip into King St E hit a bus at 11.6 m/s.
  - **Median noses** (world.js `_medianNose`, arterial.js `medianNoses`,
    citygen `noseLift`): a median half meeting a junction (node of 3+
    edges) ends in a quarter circle kerb to midline -- the two halves a
    bullnose -- where the strip has 2R + 1.5 m of room and the nose is not
    on another carriageway; slab and kerb face round the curve, the corner
    it leaves asphalt, and roadLift reports carriageway there (the same
    numbers: paveStart is the junction arm's kerb return).
  - **Verify** (sequential; master in a scratchpad copy, same commands).
    `VIEW_PROBE_FILE=tools/kw/lanechoice.js` (wraps routeAdvance, runs
    jcttraffic with its options, counts turns off multi-lane approaches by
    the lane they are made from) seeded, arterial sites: master 0 L / 1 R
    turns, 1 R from the wrong lane (the v62 slip crash's neighbour); this
    17 L (12 from the bay) / 16 R, 0 wrong; 20 lane changes, 4 turns given
    up, courtesy 18 s, slip yields 28 s. Default sites: master 0 / 0, this
    19 L (8 from bays) / 17 R, 0 wrong. jcttraffic master -> this:
    default seeded 0 hits / 0 crashes / 1 recycled -> 1 / 0 / 0 (two
    opposing lefts at signal 849, (-1872, -91), a skewed crossing where the
    two approaches' lane lines nearly meet head-on: both committed, the
    younger waited in the box and the older's gridlock-rule pass scraped it
    at 4 m/s -- the class exists on master; it shows now because lefts at
    signals went 19 -> 52); unseeded 0 / 0 / 9 -> 0 / 0 / 4 (the recycled
    are the queue at the rail crossing by (-1573, -382), on master too);
    the eight arterial sites seeded 1 / 1 / 0 -> 0 / 0 / 0 (the slip-lane
    crash gone), unseeded 0 / 0 / 0 both. hwytraffic seeded 5 -> 3 hits,
    unseeded 6 -> 9 (rerun alone: 9 again; every one a freeway side-swipe
    of the kinds and at the spots master has -- 401-hespeler's three
    identical -- after the city traffic round the sites diverged; none
    involves a turn, a bay or a slip merge). trafficbench (rail off, phone):
    401-hespeler and allway-28 = master; uptown-king, sig-1644, rb-3lane,
    pkwy-fairway change (meant: signals and multi-lane streets near them).
    stopbars 8288 / 0 across / 2 dropped = master; poleprobe identical
    (default and nine arterial sites); ionprobe, railprobe PASS; AUTO_GPU=1
    funprobe ALL OK. Phone boot 0 exceptions; spawndraws master 177 / 175,
    this 178 / 176 (1136k / 1127k -> 1140k / 1133k tris); the 13 arterial
    cameras -1..+1 draws, -5..+7k tris. Paint and noses add no draws (the
    chunk's flat / road / walk meshes).
  - **Approximate / not done:** (blinker lamps: done since, "Vehicle lamps"); lane changes happen on
    the edge being driven only (a short edge before the junction leaves
    little room, and a turn is then given up); right-turn bays are kerb
    width, not lanes; bays only on two-way roads into a signal (a divided
    road's left bay is in its median: not drawn; its left turns are from
    the leftmost lane); the through lanes flare at the node where a bay
    opens (a jog, not a taper, in traffic's lane lines -- the paint's taper
    is a diagonal); dual left lanes (`left|left|`) are one bay; a nose
    rejected for lying on another carriageway leaves its strip R short, and
    roadLift (which cannot see that test) still calls its corner road.

- **Vehicle lamps** (docs/lamps-red-queue.jpg, lamps-left-signal.jpg,
  lamps-freeway-lane.jpg: master on top, this below). Stop lamps, turn
  signals, reversing lamps and hazards on traffic, on your car and on the
  phone's far LOD, for **no draw, no attribute and no uniform**.
  - **Which faces are lamps** (vehicles.js `tagLamps`, after tagGlass, road
    types only -- not planes or boats, whose TAILC is nav lights): the trim's
    `glass` attribute gets 5 = stop / tail (a TAILC face looking back,
    normal z < -0.4, in the rear 30 % of the length, low or the centred
    high-mount lamp: a red lamp high and off-centre is a bus's or an
    ambulance's warning lamp), 6 = turn signal (an AMBER lens off the
    centreline, under 78 % of the roof -- not the cab clearance lamps -- in
    the front or rear 35 %; side = sign of x, **+x is the car's left**),
    7 = reversing (`REVL`, a new near-white lens colour: WHITE is the tint
    placeholder; sedan, compsedan, taxi, police and sports have one), 8 =
    stop / tail on a type with no rear amber. **Every red lamp off the
    centreline is a turn signal too** (North American red rear signals: the
    signalling side flashes, the other holds the brake) -- a thin amber strip
    in a tail cluster did not read from a car length back. The stage counts
    them: `LAMP_CLASSES=1 node tools/kw/carshots.mjs <dir>` (carstage's
    `lampClasses`; a car's `lamps` field there sets its bits).
  - **The state is per mesh, the plate trick again** (see PLATE_STEP):
    `Vehicle.setLamps(bits)` puts `LAMP_BRAKE 1 | LAMP_L 2 | LAMP_R 4 |
    LAMP_REV 8 | LAMP_LON 16 | LAMP_RON 32` (L/R = lit this instant, LON/RON
    = signalling at all, for the combined red lamps) in `trimMesh.scale.z` as
    1 + bits / `LAMP_STEP` (65536: under 0.1 %) and glassShader reads it back
    as z column over y column of modelMatrix (`LAMP_GLSL` lampGlow; anything
    over 63 -- tank.js's crush -- is dark). A lit lens adds emissive
    (`LAMP_RED` 2.2, `LAMP_AMB` 3.4 / 1.2, `LAMP_WHT` 2.0, linear) and drops
    its metal so the sky does not wash it out; an unlit one is 0.38 x its old
    colour (the bare TAILC read as lit in daylight). A frozen (parked) car's
    trim matrix is refreshed by setLamps itself. **Far LOD:** traffic.js
    `_farCars` scales the instance matrix's z column the same way and
    farShader reads `instanceMatrix`; clusterFar keeps a lamp's class in
    `lodG` (1 is still glass), clusters lamps on a 4 cm grid, and stands them
    `FAR_LAMP_OUT` 7 cm proud -- at FAR_CELL in their recess the clustered
    shell closed over them, so master's far cars had NO tail lamps (the
    taxi in lamps-red-queue.jpg). Scenery cars and trains keep bits 0.
  - **What lights them** (traffic.js `updateLamps`, after the sync loop,
    before updateFarLod; driven modes only, within `LAMP_RANGE` 260 m):
    stop lamps on the brake (`v._lin`, the input the driver returned, or
    aiIn), held (`v.held`), or standing without throttle, with a 0.3 s hold
    (`BRAKE_HOLD`) against aiPedals' flicker; reversing below -0.3 m/s (a
    wedge's or the gridlock rule's back-out); the signal (`lampSignal`,
    judged every `LAMP_TICK` 4 frames, staggered, held `SIG_HOLD` 1.2 s so
    it runs through the corner): a lane change under way (`lcShift`: > 0 is
    moving left) or signalled (`lcSigOn` / `lcSigDir`), a planned freeway
    exit within `EXIT_SIG` 220 m (`exitSide`), else `nextTurn` within
    `SIG_D0` 40 + `SIG_DT` 2.5 x speed m; hazards (`HAZ_HOLD` 5 s) on a car
    wedged (`stuckT` > 1.5) or stopped after a hit (`panic`). Blink period
    `BLINK` 0.7 s (~86 a minute), half lit, each car's phase from
    hash2(prio). A towed trailer / rear section shows its leader's bits.
    **Visual only:** it reads the drivers' state and writes `lampBits` and
    `v._lamp`, nothing the driving reads, no RNG (`nextTurn` writes only its
    own scratch object).
  - **Your car** (vehicles.js `driverLamps`, from player.js after update):
    stop lamps on the brake, on the throttle rolling back, and standing;
    reversing rolling back; **the signal follows the wheel at town speeds**
    -- over `DRV_SIG_LOCK` 0.55 of lock for `DRV_SIG_T` 0.25 s between 0.5
    and `DRV_SIG_V` 9 m/s blinks that way and stops `DRV_SIG_HOLD` 0.6 s
    after the wheel comes back (a self-cancelling stalk, roughly). No
    hazards, no stalk of its own.
  - **Verify:** `VIEWS=tools/kw/lampviews.json VIEW_PRE_FILE=tools/kw/lampsite.js
    VIEW_INFO='window.__lampInfo' AUTO_GPU=1 node tools/kw/kwshots.mjs <dir>`
    (`__lamp(site)`: trafficbench's pinning at a site, steps until a car fits
    `pick` -- `red` the back of a 3+ queue at a signal, `left` 6-50 m short
    of a planned left, `lane` a freeway lane change -- judged from driving
    state only, so master frames the same car; puts the blink in its lit
    half; prints type and `lampBits`). kwshots gained `VIEW_INFO`.
    trafficbench (rail off, phone): **hashes identical to master at all six
    sites** (ms 0.210 -> 0.219 mean, inside the bench's noise); jcttraffic
    seeded byte-identical (0 hits / 0 crashes / 0 stuck / 0 recycled);
    AUTO_GPU=1 funprobe ALL OK; 0 exceptions everywhere. Phone (AUTO_PHONE=1,
    GPU), master -> this: spawn 178 / 1157k -> 174 / 1146k (traffic's own
    noise: the lamps add no draw), sig-1644 queue 280 / 1415k -> 274 / 1401k,
    uptown queue 291 / 1152k -> 285 / 1137k, uptown left 185 / 1133k -> 183 /
    1122k.
  - **Approximate / not done:** (headlamps and night: "Night" below, src/tod.js);
    a freeway lane change signals only while moving over (fwyDecide has no
    signal-first step, and adding one would change traffic); a turn is
    signalled from 40 m + 2.5 s even when a junction it goes straight
    through comes first; the rear signal of a type with a separate amber lens
    flashes its red lamp too; the lit red reads orange-red through ACES at
    full strength. (Done since: every road type has a reversing lens, and
    the school bus's flashers and stop arm work -- "School buses stop"
    below; the police signal with their lights dark, and a suspect pulled
    over puts its hazards on.)

- **School buses stop** (src/schoolbus.js; traffic.js `sb`, vehicles.js
  `SB_ARM` / `sbArm` / tagLamps 9-12; docs/schoolbus-*.jpg). A school bus in
  traffic stops for children on residential and collector streets, as
  Ontario's law has it (Highway Traffic Act s. 175, MTO handbooks): **ambers
  while it slows, then stopped: reds, stop arm out, children off, arm in,
  reds off, away.** While the reds flash, traffic BOTH ways stops at least
  20 m short of it (`HOLD_BACK`); on a road with a median only traffic
  behind it does (the other carriageway is another one-way edge).
  - **When and where** (`busDrive`, from driveTraffic for `hand ===
    'schoolbus'`): by an odometer, every 110-200 m within 700 m of a school
    (kw.json's 260 school footprints and 37 named schools, `nearSchool`),
    else every 350-650 m (hashes of the bus's spawn number, never
    traffic's rng), in school hours (07:00-17:30 by the device's clock,
    read once a second). The stop is planned `need` m ahead along the
    ROUTE (max(40, v^2 / 2.2 + 6)): every way out to 25 m past it a
    residential or collector street of one lane its way (a two-way street
    of one lane a side, or a one-way carriageway it is in the kerb lane
    of), no junction (a node of three or more ways, or a controlled one)
    before or within 25 m past it. **Edges are tens of metres** (the
    importer splits a way at every bend: no res / st edge is over 100 m), so
    the stop is along the route, and its distance is run down by the
    odometer, not projected on a line. School buses now spawn on
    residential streets too (they were turned into sedans: `NO_KERB`), and
    never on freeways (FWY_BANNED, as before).
  - **The sequence** (`phase` 1-3): 1 AMBER, stopAt the remaining distance
    (it holds over 40 s or overshoots by 4 m: abandoned, `aborted`); 2 RED
    once standing within 4 m of it: the arm swings out in `ARM_T` 0.7 s,
    0.8 s later a child every 0.9 s (1-5 by hash; `__sbKids`), then 2.6 s;
    3 the arm swings in, the reds still on; then off and away. The children
    are the crowd's own pedestrians, `peds.spawnFareAt` at the door (kerb
    side, behind the front wheel) walking 9 m off the road (`fare` 2, as
    grtbus.js's alighting riders), scaled 0.58-0.72 (a child), handed back
    to the crowd after 5 s.
  - **Traffic obeys** (`obey`, from driveTraffic while `sb.list` has a bus
    -- cost nothing otherwise): the bus is found on each car's own sampled
    PATH (the leader scan's), so a car turning into the street sees it and
    one turning away does not. Its way (any lane of it): during the reds,
    stopAt 20 m short of its rear; during the ambers, 20 m short of where
    it will stand (or 20 m off it now, if already closer). The other way,
    reds only, two-way street only (no median): 20 m short of its front; one
    already alongside drives on. `v.sbHold` counts as a signal's hold for
    the 20 s stuck-recycle (`restT`). A unit in pursuit does not stop.
  - **The lamps and the arm, no new draw** (vehicles.js): one lamp state
    of its own, `LAMP_SB` 64 + code (codes 0 / 1 the ambers, 2 + side + 2 x
    arm step the reds and the arm, `SB_ARM_STEPS` 40; at most 145, 0.22 % of
    scale, the plates' order), from `lampBits` in updateLamps. The lit side
    alternates every `FLASH` 0.4 s (~75 a minute), the stop lamps are on,
    the turn signals dark. tagLamps (school bus only): 9 the overhead reds
    (`SB_RED`), 10 the overhead ambers (AMBER above 78 % of the roof), 11
    the arm's face and STOP (`ARM_RED` / `ARM_WHT`: now trim, both faces),
    12 its two red lamps (`ARM_LAMP`, flashing top and bottom in turn). The
    trim shader (and the far LOD's) swings 11 / 12 a quarter turn about
    `SB_ARM`'s hinge at the arm's front edge (`sbArm`, position and
    normal), so STOP faces oncoming traffic and its back the traffic
    behind. The shadow pass does not swing it (its shadow stays folded).
  - **You** (`update`): passing a bus whose reds flash -- from one end of
    it past the other, within 12 m of its side, moving; not the other way
    across a median -- is an offence once a stop: `traffic.onSchoolBusPass`
    (main.js) toasts "You passed a stopped school bus -- $400-$2,000 and 6
    demerit points in Ontario", and if a police car (within 150 m) or an
    officer on foot (70 m) sees it, `game.addHeat(30)` -- one star, as
    any offence the game punishes is heat.
  - **Switches:** `window.__noSchoolStops = true` (any time) is master's
    traffic to the bit; `__sbHour` stands in for the clock, `__sbGap` (m)
    for the distance between stops, `__sbKids` the children.
  - **Verify:** `VIEW_PROBE_FILE=tools/kw/schoolbusprobe.js node
    tools/kw/kwshots.mjs <dir>` stages it (game paused, every random source
    pinned, spawning off): the longest straight two-way one-lane street
    near (-3020, -2350) (a chain of edges through two-way nodes), a school
    bus, three cars following it, three coming the other way 4 s later;
    PASS = amber > red > arm in > away, children off, cars stopped behind
    and opposite, every one 20 m or more short of it, nobody passed, the bus
    went on. `window.__sbp = { median: true }`: a divided road's
    carriageway, and the other carriageway must drive on. `you: true`: a
    stand-in for your car driven past it must be called an offence once.
    Stills: `VIEW_BOOT_JS='window.__sbPre=1' VIEW_PRE_FILE=tools/kw/schoolbusprobe.js
    VIEWS=tools/kw/schoolbusviews.json AUTO_GPU=1 node tools/kw/kwshots.mjs
    <dir>` (near Keatsway PS). The arm on the stage:
    `node tools/kw/carshots.mjs <dir> tools/kw/schoolbusshots.json`
    (`lamps` 64 ambers, 104 half out, 144 / 145 out, reds either side).
  - **Results** (master v71 -> this). schoolbusprobe PASS on a
    residential street by (-2863, -2361) (a 521 m chain): reds 11.6 s in, for
    7.5 s, 4 children, three cars stopped behind at 19.8 / 27.7 / 35 m
    (the second and third queued behind the first), two coming the other
    way at 20.1 / 27.4 m, nobody passed; `median` PASS on a collector's
    carriageway (the other carriageway drove on); `you` PASS (one offence).
    trafficbench (rail off, phone) with `__noSchoolStops`: all six hashes =
    master (uptown-king -3643011.414557, sig-1644 -3432739.819895,
    pkwy-fairway -2609463.266025, 401-hespeler -1398473.998642, allway-28
    -3146373.229085, rb-3lane -3020364.061433). On, at 10:00: five = master,
    uptown-king -3642423.112697 -- the bench's only school bus stop
    (`sbStops` 1, 9 s of cars held); on at 03:00 (school buses on
    residential streets, no stops) all six = master, so the change is the
    stop. jcttraffic seeded off = master to the number; on: 0 hits / 0
    crashes / 0 stuck both, recycled 1 -> 2 (the rb-3lane slip-lane queue
    master recycles, the run having diverged at its first site); unseeded
    0 / 0 / 0 both. hwytraffic seeded 1 hit both, unseeded 2 both, 0
    crashes. poleprobe 0 in a lane; AUTO_GPU=1 funprobe ALL OK; 0
    exceptions everywhere. Phone (AUTO_PHONE=1, GPU, seedrandom), master
    -> this: spawn 179 / 1173k -> 175 / 1161k, air views -3..-5 draws
    (traffic's noise); the stop (schoolbus views, phone): 131-150 draws,
    244 behind the queue -- the arm, lamps and children add no draw (the
    children are the crowd's).
  - **Approximate / not done:** the bus stops IN its lane at the kerb side
    (as Ontario's do, so traffic cannot pass), it does not pull in to the
    kerb; stops are where the odometer says, not real stops, and every
    day is a school day (no weekends, no summer); there are no children
    waiting to board, and the children never cross in front of the bus;
    the arm's swing is 40 steps; the "other way" rule needs the bus on a
    two-way edge, so a two-way street with a raised median mapped as one
    way would count as two-way; the follower that was already within 20 m
    when the ambers came on stops where it is; police cruisers do not stop
    for it in pursuit, nor does drivePolice's close-in driving look for it.

- **Reversing lamps on every type, the police's signals**
  (vehicles.js `addReversing`, traffic.js updateLamps). The "Vehicle
  lamps" leftovers.
  - **A reversing lens where a builder drew none:** after the builder, a
    REVL box is laid ON each rear tail lamp (the TAILC faces looking back
    in the rear 40 %, each side of the centreline, under 85 % of the roof),
    4 mm proud of it so it never floats off the body: the inboard lower
    corner of a wide lamp (40 % x 50 %, at most 12 x 7 cm), a band across
    the middle of a tall strip (a pickup's, a van's, a bus's), a 12 cm lens
    set in a light bar's end (the wedge). Not the motorbikes, bicycles,
    quad, buggy, kart, tank, farm machines, boats, the semi's trailer.
    `LAMP_CLASSES=1 node tools/kw/carshots.mjs <dir>`: class 7 on every
    road type but those (hatch, suv, crossover, pickup, minivan, wagon,
    jeep, van, bus, boxtruck, muscle, convertible, wedge, evy, semi,
    uhaul, ambulance, swat, garbage, fireengine, articRear, tillerRear...).
  - **The police signal with their lights dark** (a unit driving somewhere
    with no heat, or heading off once it is gone: `md === 'police' &&
    !game.wanted`), as traffic does; a unit running with its lights on does
    not, nor a suspect fleeing. **A suspect pulled over** (policemissions'
    getaway `stopT` > 0) puts its hazards on.
  - **Not done:** the optional freeway signal-before-moving-over (it would
    change traffic; not attempted).


- **Lefts whose ways meet, and the gridlock rule** (v63's open item: the
  4 m/s scrape at signal 849). **Root cause, traced:** two opposing lefts
  waited at their lines through the red; on the green the older went and the
  younger was told to wait -- but it had crept 0.6 m over its line, so
  junctionStop committed it anyway ("too late: through", meant for a red).
  Both stopped nose to nose in the box, each the other's leader, and the
  gridlock rule let the older one drive on THROUGH the younger. And v63's
  `oncoming` rule dropped a committed left more than C.r + 3 from the
  centre, which a car committed at a far stop line is (signal 528: a bus and
  a minivan, the same frame).
  - **`leftClash`** (junctions.js; replaces the opposing-left block in
    `oncoming`): a left at a signal -- permissive OR protected (a skewed
    dual-lead advance has crossing arrows too) -- waits while another left
    of the same phase group would meet it in the box. "Meet" is GEOMETRY:
    both cars' own planned paths (`TrafficSystem.pathAhead`, the arcs they
    drive) sampled every 1.5 m inside C.r + 3 of the centre (`boxPath`),
    closer than their half widths + `CLASH_PAD` 0.9 m (`pathsMeet`). The
    other car counts if it has committed (wherever its line is; `jcFrom` /
    `jcFromC` keep the approach after jcGo clears at the node, until its way
    has no point left in the box), or if it is OLDER and within 8 m of its
    line on a light that lets it turn. Its own approach counts too when it
    is in the next lane (> 1.6 m across): two lefts abreast whose arcs close
    in the box (signal 447). This engine's opposing lefts mostly DO meet
    (their arcs pass near the centre even at a square crossing), so in
    practice they still go one at a time, as v63's rule had them.
  - **A left held for its way is held where it is** (`decide` returns 3):
    never committed as too late, even over its line -- it waits in the
    mouth of the box, as drivers do. On the amber a left that crept to its
    line goes only once the way is clear (oncoming / leftClash), as before
    only a red could hold it.
  - **The gridlock rule never drives through a car** (traffic.js scan): the
    older of two cars waiting on each other passes the younger only where
    the younger's body leaves its way a body width (`v.halfWid + ext +
    0.1`, not the scan's margin). Otherwise the younger is told to make way
    (`mkWay`, `stats.gridBlocked`) and goes first if ITS way is clear of the
    older (`gridMadeWay`); if neither can pass for 2.5 s it backs off 1.2 s
    at a walking pace -- only with `roomBehind(v, 4)` -- and plans afresh
    (`gridBackOut`).
  - **Sweep:** `VIEW_PROBE_FILE=tools/kw/leftsweep.js node tools/kw/kwshots.mjs
    <dir>` (~6 min; `window.__ls = { only: ['sig-558b'], pL, warm, measure,
    offset, limit, every }`): every signal with a left-turn lane plus every
    SKEWED one (353), each alone and seeded by its index, 8 + 40 s, with
    pickNextEdge wrapped so 60 % of cars turn left at a signal; prints hits,
    near misses (two cars committed into one box from different approaches
    within 0.4 m), left commits, recycled cars and why (`recLog`), and the
    stats above. Master -> this: hits 14 -> 3, near misses 9 -> 1, recycled
    5 -> 5 (the same five queues), lefts 1949 -> 1793 committed in 14,120 s
    (the opposing ones wait now), gridBlocked 0 -> 19.5 s, 6 back-outs.
    Opposing / abreast lefts: 8 sites with hits or near misses -> 0. The
    four left are other classes, identical on master: a semi's trailer
    swinging into a stopped SUV (sig-422b, 200 m off), a rear nudge at a
    right on red (566b), a rear-end at 8 m/s between moving cars (640b),
    two straight-through cars converging from a skewed junction's two
    approaches (681s, a near miss).
  - **`tools/kw/jcttraffic.js` keyed every pair "undefined:undefined"**
    (vehicles have no `id`), so a hit within 1 s of ANY other was not
    counted and every car shared one stuck timer; ids come from a WeakMap
    now. Numbers below use the fixed probe on both builds.
  - **Verify** (sequential; master a detached scratchpad worktree with the
    fixed probes copied in, same commands): jcttraffic default seeded 1 hit
    (849) -> 0, unseeded 0 / 0 / 4 recycled both; arterial sites seeded and
    unseeded 0 / 0 / 0 both; lefts at signals (arrow + permissive) default
    seeded 52 -> 51, arterial seeded 20 -> 28. lanechoice arterial 17 L /
    16 R -> 23 / 16 (15 from bays), default 19 / 17 both, 0 wrong.
    hwytraffic seeded 3 / unseeded 9 hits both, = master. trafficbench (rail
    off, phone): all six hashes = master (nothing at those sites meets the
    new rules in 1,500 updates). ionprobe, railprobe PASS; phone boot 0
    exceptions, spawn 173 -> 176 draws (traffic; nothing new is drawn).
- **ENTER's debounce is real time** (player.js `ENTER_DEBOUNCE` 450 ms of
  performance.now(); was 0.45 s of frame dt). main.js clamps dt to 0.06 s,
  so below ~16 fps the debounce stretched to seconds and a second press was
  TAKEN AND DROPPED: funprobe's rare "FAILED 1" with 0 exceptions on a
  loaded machine (six runs on an idle one all passed; the failing run's
  shot times show the 3 s `until` of "ENTER again at the window gets you
  out" timing out). Reproduced on master by busy-waiting each frame
  (~2.5 fps): ENTER at the Tims window after getting out of the A&W's did
  nothing. A player on a struggling phone hit the same. funprobe's skater
  check now matches each skater to itself across its 2 s (it compared by
  list index, and one taken back by the crowd shifted the rest). AUTO_GPU=1
  funprobe x3 ALL OK.
- **The country's stores, and GRT's stop flags and shelters**
  (docs/rural-*.jpg, grt-stop-*.jpg: master over this).
  - **Why ~190 stores were plain boxes:** prepShops draws a front (shops.json
    `fronts`) only inside what a `kwp` cluster already draws (+60 m, or a
    neighbour's within NEXT_M) -- a front out past every cluster would add a
    draw that is never culled by range. Those (Breslau, Conestogo, the farm
    markets, the auto rows past the plazas, Guelph's dealers) stayed
    world.js's generic boxes, and stores in farm buildings (cls 6: barns,
    farmhouses) were skipped by style. **Now** such a front is drawn as every
    other one, into its OWN cluster, `kwr:<1200 m cell>` (prepShops `rk`;
    buildShops' `key()` redirect plus `curKey` while it is drawn, so its road
    pylon and lettering land in it too), which landmarks.js range-culls at
    `KWR_RANGE` 1500 m (the near ring's reach: NEAR_R 2 chunks of 400 m).
    Past that its box comes back as the world's mid-ring / far massing
    (`kw.mass`: world.js draws those boxes `massInset`, 0.25 m inside the
    store's walls and 0.4 m under its roof, so where both draw nothing
    z-fights). A store the importer put in a farm building keeps farmstead.js's
    building when it is a shop (`kind` s) or a market by name, and gets
    `kw.sign`: a green board with its name beside the barn's doors and a
    `woodBoard` on posts by the road; a garage / dealer / pad / kiosk in a
    "barn" (a big untagged box out of town) is drawn as a store.
  - **Farm markets** (`isMarket`: MARKET_RE on the OSM names, NOT_MARKET for
    variety stores, pizza, auto, storage...; rural fronts only, < 2600 m2):
    `farmMarket` -- board-and-batten walls (barn red, white, weathered), a
    ribbed steel gable along the long axis (green / red / galvanised /
    charcoal), a porch on posts with a shed roof along the storefront, the
    glass and doors under it, crates of pumpkins, squash and apples, the name
    on the wall over the porch (the independents' lettering, `sh.sy/so`) and
    on a board by the road. Pads' roofs by kind (kiosk white, bank and
    restaurant ballast grey, garages galvanised).
  - **Counts** (`VIEW_PROBE_FILE=tools/kw/storeprobe.js`, runs on master):
    PLAIN boxes 177 -> 12 (the rest are 2-storey main-street shops with flats,
    left on purpose); farm-building stores unsigned 20 -> 1 (14 signed, the rest drawn as stores); lettered names
    1400 -> 1585 of 1858, + 11 farm-building signs and their road boards; 172 fronts in 85
    `kwr:` clusters (~40k tris), 7 farm markets.
  - **GRT stops** (world.js `_grtStops`): the flag carries GRT (white italic
    on the blue band) and the stop's number (OSM `ref`, grtstops.json's 4th
    field) on the white strip, both faces, as **streetsigns.js lettering**
    (`setExtra(cx, cz, sites)` per chunk; two shared slots in its atlas --
    `G|grt` and `G|digits`, a number laid a digit at a time with a face's
    `cu` px range -- so every stop costs no slot, no material, no draw;
    within `GRT_R` 110 m). Shelters (shelter=yes), three designs: the
    ION-era glass shelter (charcoal frame, flat roof cantilevered to the kerb,
    blue fascia lettered GRT), its double-length iXpress version (iXpress
    stops: green line under the fascia, a lit route map), and the older ad
    shelter (bronze frame, barrel roof, a lit poster case at one end); 45/55
    by hash. **v62's shelter stood turned 90 deg**: with rot = atan2(-nx, nz)
    Builder.box's local x (w) runs ALONG the kerb and d out from it -- the
    back glass and roof were laid across the walk.
  - **Verify:** phone (AUTO_PHONE=1, GPU), master -> this, two runs: spawn
    175/175 -> 177/176 draws, 1150k = ; air views +0..+3. A rural store in
    view within ~1.5 km of its cell costs +1 draw a `kwr:` cluster.
    trafficbench (rail off, phone) hashes identical at all six sites;
    AUTO_GPU=1 funprobe ALL OK (63); poleprobe 0 in a lane, 0 trunks; 0
    exceptions. Views: kwshots with `eval: "for (const n of
    d.lmRoot.userData.near) n.o.visible = true"` (a paused harness does not
    range-update the near meshes).
  - **Not done:** the stop flag shows no route numbers; shelter design is a
    hash, not the real stop's; farm markets are one kit (no Mennonite
    Story-style variety); stores past the edge (Elmira, New Hamburg, Ayr,
    Baden) are not on the map; from the air past 1.5 km a country store is
    its massing box.
- **Weather: src/weather.js** (docs/weather-rain-king.jpg, weather-snow-street.jpg,
  weather-overcast-air.jpg). States clear / overcast / rain / drizzle / snow /
  fog, each a mix of four numbers (`over`, `rain`, `snow`, `fog`) plus two
  that lag them on the ground (`wet`: ~30 s to soak, ~2 min to dry; `cover`:
  snow lying in ~45 s, gone over ~3 min, faster in rain). **Auto** (default)
  holds a state 4-9 min and fades 50 s to the next, drawn from `MONTHS` --
  Waterloo Region by month (snow Nov-Mar, most Dec-Feb; rain spring and
  Aug-Nov; clearest Jul-Sep; fog in the shoulder seasons) on the device's
  clock; **the first auto state is clear for 3-5 min**, so a fresh session and
  every harness start on the city as built. The pause menu's Weather row
  (Auto / Clear / Rain / Snow) is localStorage `autokw-weather` and fades in
  ~7 s. Harness: `window.__weather = 'rain'` (any state, or 'auto') SNAPS at
  the next drawn frame, ground included; `window.__wx` is the live state
  (`cur`, `k`, `draws`, `done`, `set(mode, instant)`, `choose(setting)`).
  **THE LAW: clear weather changes nothing.** Every shader term is behind a
  uniform branch (`wxOn`), every light / fog / gameplay factor is x exactly 1,
  the precipitation mesh is not even built and the IBL is never re-rendered
  -- trafficbench hashes with `__weather="clear"` equal master's.
  **How it reaches every material:** weather.js sets
  `THREE.Material.prototype.onBuild` (nothing else uses it; three calls it
  for each new program just BEFORE the material's own onBeforeCompile), so
  one block goes in before `<emissivemap_fragment>` of every standard /
  lambert / phong program, and each material's hook then edits round it.
  **Never wrap onBeforeCompile / customProgramCacheKey on the prototype
  instead:** landmarks.js `plainPalette` and vehicles.js's dent test compare
  onBeforeCompile by identity, and a getter there split the landmark
  clusters' merges (+10-20 draws in the air). In the block (`normal` is
  view-space, `vViewPosition` gives the world position): WET darkens by
  porosity (rough surfaces most), lowers roughness on what faces up, and
  noise puddles (roughness 0.05) on flats; SNOW whitens by how much a face
  looks up (roofs, lawns, crowns, kerbs), drifted by noise. Kinds by
  `userData.wx` (a tagged material needs its OWN program key -- three shares
  a program, defines and all, between materials with one key): 'road'
  (`mats.road`, key 'wxRoad'; the far roads) and 'roadwalk' (roadWalk, by its
  `vSurf`) are PLOWED -- wet with melt, grey slush in patches and a ridge of
  it along the kerb (the vertex colour's kerb grime, meshRoad `wear`, says
  where the kerb is), pavements shovelled, gravel snow-packed, verges white;
  'nosnow' (the vehicles' trim); a program key with `water` takes no snow or
  puddles; skinned meshes skip snow. `testWeatherShaders(renderer)` compiles
  it on throwaway materials before anything real compiles, and a driver that
  refuses it gets `WX.ok = false`: no block anywhere, never a black city.
  **Sky and light:** world.js buildSky's `overcast` (sky to `ovHor`/`ovZen`,
  clouds closed into a textured grey deck, the disc gone), `skyFog` (the
  haze climbs the sky), `haze` lerped to `ovHaze`; the sun x(1 - 0.92 over),
  hemi x(1 + 0.45 over), ambient x(1 + 0.7 over) -- shadows go soft; fog
  colour toward `FOG_OVER` (main.js syncFogColour), density x `fogK` (main.js
  draw: base x altitude x weather; rain ~10x, snow ~17x, fog ~81x -- the haze
  thins with height, so these are large); `world.relightSky()` re-renders the
  IBL at overcast 0.5 and 1 only. **Precipitation** (`Precip`): ONE draw, a
  ShaderMaterial over 6400 quads (3600 phone) whose vertex shader wraps them in
  a 34 x 20 x 34 m box round the camera (26 x 16 x 26 for snow): rain streaks
  along the fall + wind, snowflakes as soft billboards swaying; fades out
  30-110 m above the ground, hidden in a bore. **Gameplay:** `WXK.mu` (your
  road car's grip and brakes, vehicles.js `this.mu`: rain 0.82, snow 0.55;
  the loose-surface ESC path comes in with it), `WXK.ai` / `aiLat` (traffic's
  pace and corner speeds), `WXK.peds` (the walkers' cap: rain x0.45),
  `WXU.wxHead` (headlamps: the trim shader lights untagged faces in LAMP's
  colour). **Sound** (audio.js): `rain` (pink noise band-passed, the roof's
  drumming played slower in a car, hushed in a bore), `spray` (your tyres on
  a wet road, by speed; duller in slush), the city ambience x0.55 in snow.
  **Verify:** `VIEW_PROBE_FILE=tools/kw/weatherprobe.js` (states, the clear
  law, draws, transitions with the game running, a sedan's 100-0 per
  weather, the AI / walker / headlamp factors, the setting); views:
  `cat tools/kw/artseat.js tools/kw/weatherseat.js > pre.js;
  VIEW_PRE_FILE=pre.js VIEWS=tools/kw/weatherviews.json`.
  Measured (AUTO_PHONE=1, GPU): clear is master's -- the same draws at
  fixed poses (a per-object draw census at air-uptown matches but for
  traffic's own randomness), trafficbench hashes identical at all six sites
  with `__weather="clear"`, seeded jcttraffic / hwytraffic output identical;
  rain or snow +1 draw and +7k tris (3600 quads); perfaudit (8x CPU) King
  St frame CPU 12.98 ms clear, 12.1-13.0 rain: inside the noise.
  **Approximate / not done:** the city stays dressed for fall under snow
  (leaves on the trees, pumpkins); snow lies on parking lots and the mid
  ring's merged roads (no flag tells them from ground); no wipers, no
  splashes or ripples, no lightning; rain falls through bridges and roofs
  (it is a box round the camera); far LOD cars' lamps stay dark; Auto
  starts clear. (Beams on the road and the time of day's light base:
  "Night" below -- tod.js writes the lights as this file's `base`.)

- **The G2 road test** (src/g2test.js, `data/g2.json` from tools/kw/build_g2.py;
  docs/g2-centre.jpg, g2-instruction.jpg, g2-sheet.jpg). Ontario's G2 (city)
  and G (adds the freeway) road tests at **DriveTest Kitchener, 1405 Ottawa
  St N** -- OSM's own `amenity=driving_school` node in the Ottawa Lackner
  Centre (Ottawa St N at Lackner Blvd). `window.__noG2 = true` before boot
  leaves it all out.
  - **Where:** a green pillar (`LOT`, one MeshBasic draw within 320 m, none
    in a test) on the lot's aisle in front of the unit; "DriveTest" lettered
    on the strip's fascia (`addDriveTestSign` adds it to the plaza's `sh` /
    `ten` before kwshops builds: DriveTest is an amenity, not a shop; navy on
    white in CHAIN_COL -- the colours are a guess); a steering-wheel icon on
    the maps (hud.js kind `g2`). ENTER on foot by the door / pillar (main.js
    `tryInteract`: the examiner's white compsedan is brought round and you
    are put in it) or stopped in your own car within 34 m (`tryDriveThru`;
    any road car under 6.5 m that is not a bus) opens a DOM chooser (G2 / G,
    keys 1 / 2, arrows + Space, a pad through `controls.bridge`), the world
    held (`game.hold('g2')`, reaped like the minigames).
  - **The route** (`pickWaypoints`): G2 = a signalled junction ~500 m out,
    a two-way street to pull over on (`pull`), a residential street to turn
    round on (`turn`), home (the street node by the plaza); G = a signal on
    the way to the freeway, then `freewayLeg`: a MERGE (a ramp joining a
    carriageway 1-3.6 km out) to the next EXIT 1.3 km+ on, the one ending
    nearest the centre (in practice the Conestoga Pkwy west of Kitchener).
    Eight tries, the loop whose planned legs (from the plaza round and back)
    come nearest 2.6-4.2 km (G2) / 5.5-9 km (G) kept. Legs are Dijkstra on
    the road graph (`plan`: one-way obeyed, `traffic.inComponent`, res 1.7x,
    art 0.9x, roundabout edges 2.5x, freeways only on the G's legs or when
    you are on one), planned from the car's current edge: a wrong turn is
    re-planned 22 m off the path ("That's alright -- I'll take you a
    different way"), never marked. Through a task-less waypoint the next leg
    is planned 300 m before and joined on (`P.ext`), so the turn at it is
    announced like any other. Directions (`nextMove`): a ramp, an exit, a
    turn (> 38 deg at a 3+-way node) or a fork; worded by the junction's
    control ("At the lights / the second set of lights", "At the stop sign",
    "At the roundabout", else "Take the next / second right" counting the
    side streets on that side) + " onto <name>"; said (toast) when it is the
    next or second of its kind and within max(70, 8 s) m (650 m for ramps),
    again as "Turn left here" at 45 m. The clipboard panel (#g2Panel, under
    #hud) shows it, the distance, the posted limit, the speed, the marks and
    the stalk; the next 1.2 km is drawn on both maps (`hud.fare`).
  - **Tasks:** `pull` (stop within 1 m of the kerb, 15 m+ from a junction:
    `pullSig` / `pullFar`, then signal left and go: `pullOut`; 75 s or
    `pullNo`); `turn` (stop, then turn the car round 150 deg+: more than 5
    moves `turnMoves`, 100 s `turnNo`; no centre-line or turn marks while
    doing it); `lc` (G, asked at the merge while the route goes on: left lane,
    then back right, each a lane change in that direction; 60 s `lcNo`).
    Home: stopped within 70 m of the pillar off the road (or 22 m on it).
  - **Marks** (`MARK`, weights this file's own; > 15 fails, `PASS_MAX`),
    judged at 15 Hz on the edge the car is matched to (`match`: roadsNear,
    alignment, hysteresis; lat = metres right of the edge's centreline):
    rolling a stop sign (`checkJunction`: not under 1 km/h with the nose in
    the last 10 m; judged with the nose 1 m over the bar, the bar is where
    `A.back` says); a late amber (you could have stopped at its onset:
    front > 0.8 v + v^2/6 + 1); right on red without stopping; speeding (>
    limit + 5, freeway + 10, for 2.5 s; limits are OSM's `maxspeed` per edge
    from g2.json within 6.5 km -- 20k edges, checked against roads.bin like
    artlanes -- else res 40 / st 50 / art 60 / freeway maxspeed); no signal
    (`sigRecent`: the stalk that way, on 0.4 s+, within 6 s) for a turn
    (`onEdgeChange`, > 40 deg at a 3+-way node), a lane change (a sideways
    move of max(2.8 m, 0.85 lane) within 5 s, on 2+ lanes, 12 m+ from a
    junction, 35 m+ after a turn; the history runs on through collinear
    joints), a merge or an exit; a wide turn (14 m into the street: in the
    oncoming half, or a right turn not in the kerb lane); the kerb (a corner
    at WALK_LIFT and off every carriageway while the centre is on the road;
    once a strike; never on freeways or ramps, never by the plaza);
    following under 1.2 s for 2.5 s (once a spell); over the centre line 1.5
    s. **Fails:** a red light (judged after the line by the move the car
    made: the light for L / S / R at the crossing; the advance arrow's `clr`
    counts as its amber), a stop sign never under 15 km/h, the wrong way 12 m
    down a one-way, 5 s on the wrong side, 30 (city) / 40 (freeway) over,
    passing a stopped school bus (`traffic.onSchoolBusPass`), any crash over
    impact 2, a pedestrian, a star of heat, leaving or losing the car.
  - **The end:** the score sheet (#g2Sheet: PASS / FAIL, each mark with its
    street, the examiner's line -- dry for a fail), `autokw-g2` keeps the
    best per test; a pass pays $750 / $1,500 the first time ($250 / $400
    after), puts "G2 licence" / "Full G licence" in the passport's extra
    line (career.js) and medals the pause menu's job rows (gold clean).
  - **The stalk** (player.js `stalk`, vehicles.js `driverLamps(..., stalk)`):
    `,` / `.` (or `[` / `]`), LB / RB in a road car with a pad (not an
    aircraft with gear, a fire rig, a plane), the ◀ ▶ buttons (#sigBtns,
    shown only during a test -- `data-g2` -- where a rig's two would be;
    they blink with the lamps). A press signals that way, again cancels;
    it cancels itself once the car has turned 0.9 rad its way with the wheel
    back. While on it IS the signal (the wheel's automatic one otherwise, as
    before): no new draw, the lamp bits as before.
  - **Verify:** `VIEW_PROBE_FILE=tools/kw/g2probe.js node tools/kw/kwshots.mjs
    <dir>` (`window.__g2p = { only: 'clean,cleanG,marks', seed }`): the game
    paused, traffic cleared, a real Vehicle moved by a kinematic driver (pure
    pursuit on the lane line it means to be in, corners filleted, under the
    limit, stops at stop lines and reds -- the signals' clock stepped --, the
    stalk on before every turn, merge and lane shift, the tasks done, a
    three-point turn that watches its corners). PASS = the whole G2 and G
    from the lot and back with 0 marks, and 23 scenarios each giving exactly
    its mark or fail (speed, excess, kerb, centre, wrongside, close, roll,
    stopfail, red, amber, signal, wide, wide into a multi-lane road, lane,
    wrongway; crash / bus / ped through the game's own hooks) plus the same
    streets driven well with none. The score sheet still: `__g2p = { sheet:
    1 }` as VIEW_PRE_FILE (a G2 with a stop rolled and a stretch over the
    limit, its sheet left up).
  - **Results:** g2probe PASS (seeds 11, 21, 33): G2 12.9 min / 5.3 km of
    simulated driving, G 22 min / 15 km, 0 marks. trafficbench (phone, rail
    off, clear) hashes identical to master at all six sites; seeded jcttraffic
    and hwytraffic output identical; poleprobe identical (the boulevard tree
    count moves run to run on both); AUTO_GPU=1 funprobe ALL OK (63 ok both);
    0 exceptions. Phone spawn (seedrandom, GPU): master 175 draws / 1142k,
    this 174-177 / 1138-1149k -- traffic's noise, every static group equal.
    Route picking 7-18 ms on the desktop (once a test), a leg's Dijkstra ~2 ms.
  - **Approximate / not done:** the marks' weights and PASS_MAX are made up
    (MTO publishes no sheet); no school-zone limits, no parking task, no
    hill park; a stop sign's line is the game's bar, and the stop is judged
    with the nose up to a metre over it; yield signs and roundabout
    right-of-way are not marked, nor is a left turn that finishes in the
    kerb lane, a missed shoulder check or a too-slow freeway speed; lane
    changes are told from the sideways drift on the matched edge, so a
    sloppy weave over 2.8 m reads as one; the G's freeway is usually the
    same stretch of the Conestoga and the G test runs ~20 min; DriveTest's
    sign colours are a guess; the examiner speaks in toasts only.

- **Night: src/tod.js** (docs/night-king.jpg, night-dusk-401.jpg,
  night-kitchener-air.jpg, night-res-lamps.jpg). The pause menu's Time of
  day row: **Day** (the default: the game exactly as before), **Real clock**
  (the device's wall clock read as Waterloo's local time, the sun where it
  really is at 43.47 N on today's date -- `solarAt`, NOAA's approximation,
  Ontario's DST; re-solved every 10 s of frames), **Dusk** (the sun 1.5 deg
  up at today's real sunset azimuth) and **Night** (22:30 today), saved as
  localStorage `autokw-tod`. Harness: `window.__tod = 'night' | 'dusk' |
  'day' | 'real' | <hour>` snaps at the next frame; `window.__todInfo` is the
  live state (el, az, hour, dusk / night 0..1, lamps, heads, relights,
  `lampList`, `k`). The look is two numbers from the sun's elevation:
  `du` (dusk, 16 deg -> 3 deg up, gone by -8) and `ni` (night, 1 -> -10 deg);
  Real clock with the sun over 16 deg is Day, exactly.
  **THE LAW (weather.js's): Day changes nothing.** Every shader term is
  behind `todOn` (0), the sky's uniforms and the lights keep main.js /
  world.js's values (copied at construction and written back), the IBL is
  never re-rendered, TODK's factors are exactly 1.
  `tools/kw/nightprobe.js` checks it against `tools/kw/nightmaster.json`
  (master's lights, fog and 31 sky uniforms, captured by running the same
  probe on master: it prints `SNAP <json>` when tod.js is absent).
  - **One hook.** TOD_BLOCK goes in through weather.js's
    `Material.prototype.onBuild`, AFTER `<emissivemap_fragment>` (weather's
    block stays before it), into every standard / lambert / phong program;
    tags by `userData.tod` ('win') and weather's `wx` road tags (TOD_ROAD),
    each with its own program key (`farWin` for the far skyline; the glass's
    and the roads' hooks are their own). A MeshBasic with a map (signs,
    banners, lettering) is dimmed to `todBasic` 0.42 at night
    (`TOD_BASIC`); one that is a lamp sets `userData.todKeep` and a program
    key of its own (junctions.js's signal lenses). `testWeatherShaders`
    compiles both blocks on throwaway materials first; if that fails the
    time of day alone is dropped (`TOD.ok` false: Day, always) and the
    weather's block tried on its own.
  - **Sky** (world.js buildSky, no new draw): `todOn` / `todGlow` /
    `todStars` / `moonDir` in the dome's own shader -- the disc goes orange
    and sinks to the real sun (`sunDir` slerps from the game's sun below 16
    deg), a warm glow on the sun's side of the horizon, hashed stars (cells
    of 1/260 rad) and a moon (SE, 33 deg up) behind the clouds; the colour
    stops (`zenith`, `mid`, `horizon`, `haze0`, `sunCol`, `cloudLit/Dark`,
    `groundHi/Lo`, the overcast greys, `hazeToward/Away`) lerped day ->
    `DUSK` -> `NIGHT`. **The IBL is the ambient**, so it is re-rendered
    (`world.relightSky`) at quantised looks (du in quarters, ni in sixths:
    a few renders through an evening on the real clock, never by day), with
    the weather's own overcast step. Fog colour follows (main.js `fogTone`,
    which syncFogColour now reads; by day the same two hexes).
  - **Lights** (no new THREE light): the sun keeps its direction (the
    shadow cache, trees and the fog's sun side are built round it) and
    becomes a dim cool moonlight; hemisphere and ambient go blue and stay
    readable on a phone. tod writes them as weather.js's `base`, so the
    weather's multipliers stack on top. **The shadow pass is skipped at
    night** (`shadowsOff`, ni > 0.6; main.js `nightShadows`): the sun's box
    is parked under the world (every receiver falls outside it, getShadow
    skips its taps), the near-shadow map parks itself, two frames are
    drawn so both maps are empty, then `shadowMap.autoUpdate = false` --
    no recompile. Day puts it back and invalidates the cache.
  - **Lights without lights.** Windows: world.js facadeMat's own windows
    (the glazing mask, the variety pass's window cell, a hash per window,
    `todWin` of them lit -- 0.55 in the early evening, 0.4 at 22:30, ~0.1
    at 4 am -- warm or cool; not the signs cell, which keeps its glow) and a
    procedural 3 x 3.5 m grid on the `win` materials' vertical faces (glass
    towers, the far skyline; faded to its average past 250-900 m). Street
    lamps: every lamp head the near chunks draw is recorded
    (`grp.userData.lamps`: hydro cobra heads, `_eraLamp` 1-4, lot standards)
    plus Uptown's King St posts (kwplaces.js -> `STATIC_LAMPS`); every 0.2 s
    or 6 m the `TOD_N` (8 phone / 12) nearest a point 28 m ahead of the
    camera go into `todLamp` (fading out toward the set's edge), lighting
    everything below the head (`down`: a luminaire throws its light down,
    so the crown it hangs in stays dark) with Lambert and a 24 m reach;
    on the roads x4 (asphalt is dark and the pools are what you see).
    Past 70-260 m the roads take an even warm glow (`todRoad`): the air
    view's lit street grid. Beams: your road car's and the 3 nearest moving
    cars' ahead of the view (`TOD_H` 4 cones in the same block, 55 m, dipped
    4 deg, brightest 10-20 m out); headlamp lenses through weather's
    `wxHead` (now the max of the weather's and `TODK.head`); tail lamps
    glow at a third of a stop lamp (`todTail`, vehicles.js trim shader).
  - **Life:** `TODK.peds` (peds.js cap x WXK.peds: ~0.6 at 22:30, 0.15
    small hours), `TODK.traffic` (traffic.js TRAFFIC_TARGET: 0.96 at
    22:30, 0.35 after 2 am); the city's hum half as loud at night (audio.js
    `night`). All exactly 1 by day.
  - **Verify:** `VIEW_PROBE_FILE=tools/kw/nightprobe.js node
    tools/kw/kwshots.mjs <dir>` (ALL OK: Day = master's snapshot before and
    after a night, every setting, the real clock on a mocked Date -- 03:00
    night, 12:00 day, 18:15 dusk, then sinking on its own -- lit windows,
    lamps, shadow pass off, the menu). Views: `cat tools/kw/artseat.js
    tools/kw/nightseat.js > pre.js; VIEW_PRE_FILE=pre.js
    VIEWS=tools/kw/nightviews.json` (`__carSeat`: your car in the lane,
    camera behind it). Measured (AUTO_PHONE=1, GPU): Day vs master, seeded,
    the kwshots air views: no colour shift (mean signed difference of the
    lower halves < 0.01 levels, what is left is grain), draws within
    master's run-to-run wander (177/284/215/147/225 -> 176/282/212/145/220);
    trafficbench (rail off, clear, `__tod="day"`) all six hashes = master;
    weatherprobe ALL PASS; AUTO_GPU=1 funprobe ALL OK; 0 exceptions. Night
    vs day at the same pose: scene draws equal (247 / 247 on King St, 229 /
    229 in the probe); the shadow pass 16-29 draws -> 0-1; perfaudit 8x CPU
    (frame mean, day -> night): spawn 12.2 -> 10.4 ms, King St 13.0 ->
    11.6, the Parkway 13.8 -> 12.7.
  - **Approximate / not done:** the light's direction does not move with
    the sun (only the disc does), so dusk shadows fall from the afternoon
    sun; the moon has no phase and is in a fixed place; no fill or pools
    from lamps the chunk builders do not draw (landmarks' own light
    standards, the square's, parking lots inside kw.js / kwshops clusters);
    the landmarks' and King St heritage blocks' windows (modelled geometry,
    vertex colour) stay dark; storefronts are not lit from inside; far-LOD
    and scenery cars have no lamps at night; traffic's beams are only the
    3 nearest; signs are dimmed evenly (no lit vs unlit signs); the lamp
    light ignores occlusion (it reaches through a wall to the other side);
    the phone GPU's fill cost of the block (up to 8 lamps + 4 beams per lit
    pixel, at night only) is not measured on the iPhone -- the Mac harness
    shows the CPU side only. Rural roads carry no street lights, so the
    countryside is lit only by your beams.

## Build number

`<div id="build">vN</div>` in index.html and `CACHE = 'autokw-vN'` in sw.js
go up together, once per change (see "Build number" below for why two literals).

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
- **`guide/rendering.md`** (56 KB) -- pipeline, shadows, surfaces, judging screenshots, draw-call budget, the gfx169 pass, the trees, the fall season and its sun.
  Sections: "Rendering pipeline"; "Shadows: snap the box, fade its edge"; "Surfaces: glass, windows, roofs, trees, ground"; "Judging how it looks"; "Draw-call budget"; "Mountains on the horizon"; "Far buildings take their real colour (v166)"; "A phone-neutral graphics pass (docs/gfx169)"; "A green Seattle: trees as records, three levels of detail"; "Fall (v232)".
- **`guide/city.md`** (23 KB) -- building variety and outliers, street objects, landmarks, parks, lots/plazas/yards.
  Sections: "Buildings: variety"; "Houses: dormers, garages, and modern townhomes (v156)"; "Buildings: character by era and use (v233)"; "Buildings: the outlier scan"; "Solid street objects"; "Landmarks"; "Parks"; "Lots, plazas and yards".
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
- **`guide/transit.md`** (52 KB) -- Monorail, Link light rail, BNSF freight, the Bainbridge ferry, the Queen Anne Counterbalance streetcar.
  Sections: "The Monorail"; "Freight: BNSF's main line (v160)"; "The Seattle-Bainbridge ferry (v164)"; "Link light rail (v146)"; "The Queen Anne Counterbalance: Route 26".
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
src/fall.js                 the season: pumpkins (records, instanced near the camera) and the
                            leaves coming down; the rest of fall is listed in "Fall (v232)"
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
src/golf.js                 golf on fourteen of OSM's real courses (data/golf.json), three holes a round
src/skating.js              Auto KW: skating on Waterloo Public Square's rink, and the skaters
src/ballpark.js             Auto KW: Jack Couch Park (the Kitchener Panthers) and its home run derby
src/wheelride.js            the Great Wheel's turning half and the ride on it
src/fishtoss.js             the fish stall at Pike Place Market + the catching game
src/hoops.js                basketball courts in the parks + the free-throw game
src/stunts.js               stunt-jump ramps (geometry + height query) and their scoring
src/monorail.js             the Seattle Center Monorail: beams, stations, both trains
src/link.js                 Link light rail's 1 Line: tracks, guideway, bores, stations, the trains
src/freight.js              BNSF's main line: the bed and its carve, crossings and gates, the freights, driving
src/railcars.js             freight rolling stock: BNSF / CN locomotives, hoppers, coal, tank cars, boxcars, lettering
src/counterbalance.js       Route 26, the Queen Anne Counterbalance: rails, slot and wire on today's streets, the 1902 cars, the counterweights, driving and riding
src/ferry.js                WSF's Seattle-Bainbridge ferries: the boats, their decks as a moving surface, the terminals' roads
src/bikes.js                bike paths drawn and ridden, AI cyclists, bike-share docks
src/piers.js                every other pier OSM maps, as a deck on piles; decks under sheds in the sea
src/islands.js              the islands across the Sound: Easter eggs, the Sasquatch, Blake's deer
src/orcas.js                a pod of orcas off West Point (Easter egg): surfacing, blows, breaches
src/saucer.js               a flying saucer parked sometimes in a meadow (Easter egg); the 'saucer' type is in vehicles.js
src/pickleball.js           the pickleball court on Bainbridge and its screen
src/pickleballgame.js       PICKLEBALL itself: singles, the two-bounce rule, the kitchen (no DOM)
src/shadowcache.js          phones: the city's shadows drawn once, only movers per frame
src/chunkcull.js            the city's chunk groups frustum-culled whole before the scene pass
src/nearshadow.js           the player's own shadow map, folded into the sun's in every lit material
src/career.js               the saved wallet (auto-career) and the Seattle Passport: rank + completion counts
src/effects.js              particles + tracers
src/skidmarks.js            tyre marks on the road: one ring-buffered strip mesh, faded in its shader
src/audio.js                all sound, synthesised: engine models, one-shot bank,
                            positional traffic/sirens, radio (see "Sound")
src/radiosynth.js           the synth radio: songs written per station style, their voices
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
tools/cbprobe.mjs           the Queen Anne Counterbalance: route, service, the drive up the hill, traffic, exits, shots, draws
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
| `tools/crashcheck.mjs [--shots DIR]` | how hits respond, at fixed dt on a flat street: a T-bone (the victim's shove and spin, the striker's speed after), an offset rear-end, head-on, a PIT, bus vs sedan both ways, 30 deg into a wall at 20 m/s, your car's spin ending and steering after, a shunted AI car re-taking its lane, the Magnolia Bridge's parapet driven into and a PIT beside it (`CRASH_NORAILS=1` for the control); `--shots` the T-bone from above (see "A crash spins and slides") |
| `tools/flycam.mjs [--jitter]` | a scripted flight: camera measured RELATIVE TO THE PLANE and the plane's on-screen motion, since absolute camera movement at 116 m/s is ~2 m a frame regardless. The autopilot holds 45 m over the terrain under AND 400 m ahead, or the bay dive flies into Queen Anne. Also counts building and road pop-ins, and flies `i5high` (see "flycam: road pop-ins") |
| `tools/camtunnel.mjs` | camera height at stations through bores — nothing through the roof |
| `tools/greenshots.mjs <dir> [views] [--stats] [--fly]` | the trees: forested parks, leafy neighbourhoods from the air, residential and downtown streets at eye level; `--stats` the scene pass's draws and triangles and a frustum breakdown by category, `GREEN_PROBE` a one-off diagnostic (see "A green Seattle") |
| `tools/aircraftshots.mjs [dir] [types] [--stage] [--field] [--flight] [--takeoff]` | aircraft on a plain stage (incl. a `close` cockpit view), on their Boeing Field spots, the helicopter flown through spool/lift/hover/yaw/forward/turn/stop/land under the game's chase camera, and fixed-wing take-off numbers (see "The hangar"). `AIR_PROBE='view:x,y'` raycasts stage pixels |
| `tools/jank.mjs` | `fwy-bump`, `crossing-clash`, `barrier-on-road` added for the grading (see "Freeway grading"); `tree-on-road`, `tree-in-building`, and `tree-in-water` / `tree-on-lot` counting trees only, all off the built tree records |
| `tools/junctions.mjs [tag] [--only=cat] [--noshots] [--spawn[=R]] [--nodes=a,b]` | 19 junctions picked by kind (or every street junction within R m of the spawn, or a node list); per junction a raycast classification map, hole / stacked tarmac / crossing paint / kerb gap / sink counts, and oblique, top and eye shots (GPU by default; `JUNC_PROBE='<expr>'`, `JUNC_AT=x,z`, `JUNC_HOLES=1`). See "Junctions, dead ends, bridges" and "Where no corner fits" |
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

## The controller layout (v213)

GTA's: on foot A runs (held), X jumps, B punches, RT attacks, Y gets in; in a
car RT / LT gas and brake, A the handbrake, X the tank's gun, L3 the horn, R3
the siren, RB a rig's water (LB / RB the turn signals in a road car, g2test.js), D-pad down a taxi's fares or a police car's
missions (a rig's call), D-pad left / right the radio. The table is `PAD` in
`controls.js`. **With a pad connected the on-screen buttons stay and wear the
pad button as a badge** (`data-hint` in index.html), so the screen is the
legend -- change the two together. The menu's "Controller hints" turns
that off (`settings.padHints`, kept in localStorage `auto-padhints`): the
buttons go away with a pad, as before v213. iOS exposes no pad until a button on it is
pressed, so "the controller doesn't work" at launch is usually that. And
the press that brings a pad back after the home screen is never reported as
a press: a pad (re)joining while the app's own background pause is up
resumes (`controls.padJoined`, main.js `handlePadUi`, `bgPaused`).

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
