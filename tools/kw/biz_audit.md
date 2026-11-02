# Auto KW business audit (2026-11-01)

Method: every named OSM business in `raw_shops.json` (3,912 stores) and the business-tagged POIs of `raw_pois.json`, matched by name against what the game signs: the lettering atlas's names and brand cells at boot (`window.__kwShops.tx` / `.atlas`), `shops.json` (brand keys, plaza tenants, fronts) and the hand-built modules' names (kw.json, eats.json, places, sights, home, uw, villages, lm2, src/*.js). `tools/kw/build_shops.py` `main_street_biz()` now writes the gap into `shops.json` `biz`.

Totals: 4600 distinct named places -- 2886 signed by kwshops' lettering/brand cells, 752 named in a hand-built module (Uptown, Downtown, campus, home, landmarks), 962 with no sign found.

## Where the unsigned ones are

| area | unsigned | why / what was done |
|---|---|---|
| elsewhere | 378 | see list |
| outside the map (Guelph) | 340 | beyond MAP_HALF (15600): not in the game |
| Conestoga Mall | 78 | indoor mall tenants |
| Fairview | 74 | indoor mall tenants: no street storefront to hang a sign on |
| Cambridge Centre | 68 | indoor mall tenants |
| UW campus | 17 | mostly kwuptown/uwcampus-drawn buildings (kw.skip); the rest sit on landmark-drawn halls |
| Downtown Kitchener | 4 | kw.js zone storefronts / kwdowntown |
| King St N / Laurier | 1 | main-street shops-with-flats: signed now (biz) |
| St. Jacobs | 1 |  |
| Galt | 1 |  |

## What the new pass signs (main-street businesses)

`shops.json` `biz`: 247 businesses on plain main-street boxes outside every plaza, front and detail zone -- 127 on a box the pass may sign (inside an existing `kwp` cluster), 118 signed at boot (0 unsigned for lack of lettering room); the other 120 hang on buildings another module draws (`kw.skip`/`kw.poly`: Bauer Lofts' shops with Vincenzo's, the Kitchener Market, campus halls). Each is a board over the street face's ground floor, in its own lettering look (`BIZ_LOOK`).

## Ranked: iconic / visible, and their status

Rank = how a local would name it (R0) > food, drink and shows on a main street (R1) > shops (R2). Status: SIGNED (new board) / LANDMARK (on a building another module draws; not signed here) / ZONE (kw.js's own storefront) / MALL (indoor).

| rank | business | where | status |
|---|---|---|---|
| R0 | Balzac's Coffee | elsewhere (-1885, 89) | LANDMARK |
| R0 | Brubakers | elsewhere (-5695, -2222) | LANDMARK |
| R0 | Harvest Moon Family Restaurant | elsewhere (-6212, -10282) | LANDMARK |
| R0 | Kitchener Market | elsewhere (-700, 441) | LANDMARK |
| R0 | Pho Kinh Do | elsewhere (13552, -10064) | SIGNED |
| R0 | The Silvertip Lounge | elsewhere (4574, 1771) | SIGNED |
| R0 | Vincenzo's | elsewhere (-3594, -836) | LANDMARK |
| R1 | Charminar House | elsewhere (-4907, -2643) | SIGNED |
| R1 | Egg Club | elsewhere (-4038, -2925) | SIGNED |
| R1 | GC Burger | elsewhere (-4058, -2962) | SIGNED |
| R1 | Gladiator Burger | elsewhere (-4578, -2445) | SIGNED |
| R1 | Gong Cha | elsewhere (-5162, -2652) | SIGNED |
| R1 | Hyderabad Cafe | elsewhere (-4174, -2980) | SIGNED |
| R1 | King Tin Restaurant | elsewhere (-4178, -3015) | SIGNED |
| R1 | Lily Turkish Cuisine | UW campus (-4769, -2266) | SIGNED |
| R1 | Mike's Poutine House | elsewhere (-4000, -2943) | SIGNED |
| R1 | Now Tea | UW campus (-4911, -2605) | SIGNED |
| R1 | Popular Pizza | elsewhere (-5167, -2661) | SIGNED |
| R1 | TSUJIRI Waterloo | elsewhere (-5172, -2673) | SIGNED |
| R1 | The Sobo | elsewhere (-4000, -2931) | SIGNED |
| R1 | Top Chicken | UW campus (-4908, -2599) | SIGNED |
| R0 | Ethel's Lounge | elsewhere (-3899, -1910) | SIGNED (shops) |
| R0 | Morty's Pub | King St N / Laurier (-4038, -2854) | ZONE (hand-built module) |
| R0 | Kinkaku Izakaya | Downtown Kitchener (-1471, 97) | ZONE (hand-built module) |
| R0 | Seven Shores | Uptown Waterloo (-3739, -1561) | ZONE (hand-built module) |
| R0 | Golf's | elsewhere (-661, -3200) | SIGNED (shops) |
| R0 | The Boathouse | elsewhere (-1670, 540) | ZONE (hand-built module) |
| R0 | Original Princess Cinema | Uptown Waterloo (-3916, -1653) | ZONE (hand-built module) |
| R0 | Princess Twin Cinemas | Uptown Waterloo (-3830, -1617) | ZONE (hand-built module) |
| R0 | The Jane Bond | Uptown Waterloo (-3914, -1630) | ZONE (hand-built module) |
| R0 | Beertown Public House | elsewhere (12057, 5356) | SIGNED (shops) |
| R0 | Waterloo Brewing Taphouse | elsewhere (1893, -2062) | - |
| R0 | Vincenzo's | elsewhere (-3594, -836) | LANDMARK (Bauer Lofts shops; counter only) |
| R0 | Edelweiss Tavern | elsewhere (2326, 5928) | - |
| R0 | Galaxy Cinemas Cambridge | Cambridge Centre (12552, 6523) | MALL (plaza front missing; counter only if a sign is added) |

The Counter (src/kwcounter.js) also serves 11 named locals by their OSM points: Princess Cinema/Twin (the daily silly now-playing marquee), The Jane Bond, Ethel's, Morty's, Kinkaku, Seven Shores, Golf's, Beertown, the Boathouse, Waterloo Brewing's taphouse.

## Not in OSM (so not placed)
Death Valley's Little Brother, Settlement Co., Schneiders (the plant), Brick Brewing (Waterloo Brewing is drawn by kwbiz.js).

## Left unsigned on purpose
Indoor mall tenants (~100 at Fairview, Conestoga, Cambridge Centre: no storefront); Guelph's downtown (~200, beyond the map edge); stores kwplaces/kwuptown/kwdowntown already letter in their own sign bands.

