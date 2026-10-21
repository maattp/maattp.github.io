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
  `build_bikepaths.py`, `build_piers.py` (all with `tools/.venv/bin/python`).
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
- **ION is Seattle's link.js** on `data/link.json` from tools/kw/build_ion.py
  (one car, ION livery, one-track split stations: `st.key`).
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
  Also drawn here now: the **Marsland Centre** (the BMO tower, 52 m, tan
  fins, BMO signs; `MARSLAND*`) and the **Uptown Parkade** across King
  (`PARKADE`, five open decks). The Seagram Lofts (buff, small windows,
  SEAGRAM DISTILLERS painted on No. 3's face toward Uptown). **Waterloo Park:** footbridges (`BRIDGES`, OSM ways; decks
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
    tags each edge along one (`e.gravel`: world.js draws it `GRAVEL_TINT`
    with no paint, near, far and at all-gravel junctions; sidewalks stay --
    they are citygen's and roadLift's) and gives `city.gravelAt(x, z)`
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
  traffic.js), `artic` (201 iXpress Fischer-Hallman -- **GRT runs no
  articulated buses**; it wears the livery and keeps one CIVILIAN slot).
  **Lettering is `dotText`**: a 5x7 dot-matrix font (`DOT5`, upper and
  lower case, digits, `- / . ' &`) merged into runs per row, flat on a
  panel by centre / right vector / up; `led` gaps the rows, `bold`,
  `slant`. LED signs are over-bright vertex colours (`LED_AMBER` 2.4) in
  matte, so a sign in the shade still reads -- in `trim` (metal) they were
  dark. **Ontario plates** (`plateBox`, every `trim.box(..., PLATE)`
  became one): white, a blue ABCD 123 serial with the crown between, and
  hairlines for ONTARIO / YOURS TO DISCOVER; one serial per TYPE
  (`plateSerial(name)`, set in `vehicleAssets`), ~280 triangles a car.
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
