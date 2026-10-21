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
- Seattle-only systems are switched off in main.js (monorail, Link, BNSF,
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
  vertex shader waves them, `waveFlags` each frame), KW Surplus (the tank on
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
  Rockway and Westmount, all 18 holes each from OSM (golf=hole ref/par/line,
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
  Verify: `node tools/kw/golfcheck.mjs <dir> [rockway,westmount]` plays a
  round per course through ENTER and the SWING button (`GOLF_WATER=1` adds
  the penalties). Other courses mapped well enough to add: Conestoga (27,
  water), Grey Silo (16 of 18 numbered); Doon Valley is partial.
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
  Kit, same atlas, now 2048 x 2048 -- it overflowed at 1536 once Preston and
  Hespeler's signs came). **Data** (tools/kw/build_sights.py): MAIN_STREETS
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
    full lock on gravel pushes and slides. **Stability control on loose
    surfaces only**: the pull is held under what the driven tyres need for
    the bend (`latAcc` or the wheel's ask), so a floored touch GAS slides, it
    does not spin; on asphalt a rear-drive car's tail still comes out under
    power, as before. main.js's `surfaceAt` says 'gravel' on those roads
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
  (`vanLivery`: Canada Post's red block, blue stripe and CANADA POST /
  POSTES CANADA panel; Purolator's slashes and red italic wordmark).
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
  two's rails and rumble strips). Not done: the Ontario "tall wall" ends with
  no crash cushion, and there are no overhead lane-use arrows.
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
    uncontrolled; the junction-polygon artefacts in big intersections are
    master's; a two-way stop's side street can wait long on a busy arterial.
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
  **Not done:** road-name blades at rural junctions (needs lettering: the
  sign atlases are full); the outside wedge of a bend at a pass-through
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
  `SCHOOL_HOOKS`: St. Matthew (1995, one storey, "brick and steel") in
  red-brown brick with a buff band and blue coping, punched classroom windows,
  the entrance canopy and lettering on the face toward the board's sign node,
  the gym up through the roof, the roofs' solar arrays (aerial), the two
  portables (OSM's small buildings) with ramps; St. David (unnamed in OSM: its
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
  Matthew's brick colour and gym size (no photo found; aerial only); the UW
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
  road** (above, Junctions). Seen, not fixed: a hairline of grass across
  the road at some chunk boundaries (Galt, (12000, 8800)); a garage door
  drawn over a facade window on some houses; rural fences through tree
  trunks; "the gantry behind Conestoga's Rec Centre" from (5560, 6985) is
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
src/golf.js                 golf on OSM's real courses (Rockway, Westmount), three holes a round
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
the siren, RB a rig's water, D-pad down a taxi's fares or a police car's
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
