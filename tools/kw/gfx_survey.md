# Auto KW graphics survey (2026-11-01, build v94)

Shot with `tools/kw/gfxviews.json` (+ `artseat.js`, `nightseat.js`,
`gfxseat.js`) on desktop and `AUTO_PHONE=1` (874 x 402 @ dpr 3), Mac GPU:
spawn, King St Uptown from the chase camera, a car close-up on King,
Dunbar Rd (residential), Victoria Park lake from the boathouse, the Grand
at Galt and at Bridgeport, the 401, the Uptown aerial by day / at dusk
(toward and away from the sun), dusk and night on King, the 401 and a
residential street.

What is already good, and should not be touched: the sky dome (clouds with
edges, sun-side haze, the dusk sky's colour), SSAO at `high`, the fall
crowns' colour, the night's lamp pools and headlamp beams, lit windows,
the fog's colour matching the horizon by day, rain/snow.

## What makes it look cheap, ranked (impact on the player x how often seen / phone cost)

1. **Cars read as painted plastic on the phone.** The player's car is in the
   middle of the screen 90 % of the game. The desktop has a clearcoat lobe;
   the phone has one 0.26-rough semi-metal whose reflection takes its F0 from
   the paint, so the sky comes back navy-tinted and blurred: no highlight
   band, no horizon line down the flank. *Cheap fix:* a clearcoat's IBL half
   only -- one sharp env tap x the coat's Fresnel, with the street occluding
   the low band. Same program. **Built (lacquer).**
2. **Night: the lights themselves are invisible.** The pools under the lamps
   are lit, but the heads are dark boxes, a street 200 m on is a row of
   nothing, and other cars are invisible bar their tail-lamp faces. A night
   city is read by its points of light. *Fix:* one instanced additive sprite
   draw on the lamp heads the chunks already record, and on cars' lamps.
   **Built (lamp glow).**
3. **Golden hour: the city sits under the sunset like a cut-out.** The dome
   turns orange toward the sinking disc, but the fog keeps the afternoon's
   fixed tint and density, so every distant field meets the glowing horizon
   at a hard brown line (docs/gfx-dusk-*.jpg, before). *Fix:* the fog takes
   the dome's own horizon colour per bearing, and thickens with the golden
   hour. Uniforms in the fog chunk. **Built (dusk haze).**
4. **Water is a sheet of silver foil.** At the low angles you see it from,
   every facet mirrors the bright horizon haze; there is no sun glitter (the
   0.12-rough lobe is one soft sheen) and the far chop aliases into crinkle.
   *Fix:* a tight glitter lobe toward the sun and the chop calmed with
   distance. **Built (water).** Mirrored banks (the real fix: what a river
   reflects is its treeline) were tried with a per-vertex compass of bank
   elevations; without the trees' own image the chop scattered the dark band
   into camouflage that read as mud (docs/gfx-water-banks-rejected.jpg).
   A real reflection needs a planar pass -- not affordable on the phone.
5. **The dusk light comes from the afternoon.** The sun's direction never
   moves (only the disc does), so at dusk the shadows still fall from the
   SW at 24 deg and nothing rakes. Moving it touches the shadow cache, trees'
   SUN_OFFSET and the baked mountain light: not a shader change. Not built.
6. **Trees are faceted low-poly blobs** up close (the lake and river views).
   The judge's ceiling noted in guide/rendering.md: alpha-card foliage is
   overdraw and a new material. Not built.
7. **Storefront glass is flat dark blue** on King St; the windows above have
   per-window state, the shop glazing does not reflect the street. A cheap
   fix would be a vertical-gradient env term in the facade shader's glazing
   (the street's own colour below the horizon). Next candidate.
8. **The square at night has no lamp glow** -- its posts are not in
   `userData.lamps`/`STATIC_LAMPS` (tod.js's known gap); the glow inherits it.
9. Aerial horizon by day: the flat farmland past the streaming rings is a
   uniform khaki to the horizon. The haze is right; the ground beyond 6 km
   could take the terrain's own patchwork darker. Minor.

## What was built and what it costs (AUTO_PHONE=1, Mac GPU; CPU at 8x)

See apps/autokw/CLAUDE.md "The graphics pass" for the measured table and the
switches; before/after shots are apps/autokw/docs/gfx-*.jpg (left before,
right after, same boot, same pose).
