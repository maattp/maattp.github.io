# Auto: Rendering, shadows and looks

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Rendering pipeline

Physically-shaded, image-based-lit, tone-mapped, with a hand-rolled post chain.

- **The sky is a shader dome, and the same shader is the IBL.** As
  `scene.background` the old painted equirect was 2048 px across 360 deg, so a
  62 deg view magnified it 3.6x and its cloud ellipses smeared into brush
  strokes. `world.buildSky(sunDir)` draws a `ShaderMaterial` dome that computes
  gradient, sun glow and disc per pixel and projects a tiling fBm cloud field
  (`textures.cloudNoise()`, 512 px periodic value noise) onto a flat layer, so
  clouds foreshorten toward the horizon. It replaces the background's own draw
  (`scene.background = null`), so the draw count is unchanged.
  - **Not tone-mapped, on purpose.** three leaves an sRGB background out of ACES,
    so the old sky's authored colours were the screen colours and the fog was
    tuned against them. The dome keeps `toneMapped: false`.
  - The vertex shader drops translation and writes `z = w`; with depth test and
    write off and `renderOrder -1000` the dome is infinitely far at any
    altitude, and depth stays 1.0 under it, so SSAO's sky test still works.
  - **One GLSL `skyColor(dir, forIbl)` feeds both** the dome and a 2048x1024
    8-bit equirect target, and that target goes through `PMREMGenerator` into
    `scene.environment`. The canvas equirect is deleted. Below the horizon
    `forIbl` swaps the haze for the old IBL ground ramp (#8b979f -> #5a6469), so
    the diffuse bounce every material was tuned against is unchanged and only
    what reflects changes. The upper hemisphere is multiplied by `iblGain` 1.35:
    without it street shadowQ fell 0.035 -> 0.023 and downtown's median to 0.051;
    with it every median is within ~10 % of the painted sky's.
  - **IBL is the ambient.** The analytic lights are only a key plus a fill, so
    `envMapIntensity` on a material is the main dial for how a surface reads in
    shade.
- **`PMREMGenerator` is the one half-float exception, and it's guarded.** It
  hard-codes `HalfFloatType` targets internally with no capability check, which
  is exactly what the rest of the pipeline avoids. `halfFloatRenders()` draws a
  white pixel into a half-float target and reads it back before `buildSky` trusts
  it; a definite black falls back to the 8-bit dome render as `scene.environment`
  (`world.envPrefiltered === false`) — no prefiltered roughness mips, so rough
  surfaces reflect too sharply, but the city stays lit instead of going dark.
  Anything that makes the probe inconclusive counts as a pass, so hardware that
  renders correctly today keeps the PMREM path.
- **Tone mapping is ACES, and getting it to run at all took a flag.**
  `WebGLRenderer` applies `toneMapping` only when the current render target is
  null -- when it draws straight to the canvas -- or when the target is marked
  `isXRRenderTarget`. The whole scene goes into postfx's 8-bit target, so for a
  long time **ACES and `toneMappingExposure` never ran**, and this file claimed
  they did. Highlights had no shoulder and hard-clipped to flat 255 plateaus
  that read as missing textures; the scene floor sat where the toe should have
  been, so light added at the source was eaten before it reached the
  framebuffer (hemisphere and ambient pushed 2.6x bought 1.6x on screen) and
  three separate value bugs were attacked through albedo instead. The tell was
  that moving exposure 1.02 -> 1.55 changed the measured output by less than a
  thousandth of a stop. `postfx.sceneRT.isXRRenderTarget = true` is the only
  way to get the curve applied before an 8-bit target quantises the highlights;
  it is pinned to the vendored r160, so **re-check it on a three bump**.
  Exposure lives in main.js and is meaningful now -- tune it against
  `tools/values.py`, not by eye.
- **Every surface is a set**: albedo + normal + roughness (+ emissive where there
  are lit windows). Normals are sobel'd from a purpose-drawn *height* pass, not
  from the albedo, so window reveals read as recesses.
- **`postfx.js` is deliberately not three's EffectComposer** — no addon files, and
  every render target can be `UnsignedByteType`. Half-float targets are
  unreliable on iOS (silent black screen), so the scene is tone-mapped into an
  8-bit sRGB target and bloom / FXAA / grade / vignette all work in gamma space.
  If you add a pass, keep it 8-bit.
- **Key-to-ambient is the whole look.** At hemisphere 2.0 against sun 2.5, with
  full IBL on top, ambient dominated at roughly 1.3:1 and two faces of the same
  building differed only by texture, never by light. Nothing downstream can read
  under a shadowless sky -- AO, normal maps and geometry all score flat however
  good they are. It is now nearer 4:1 (hemi 0.55, sun 3.6, envMapIntensity
  roughly halved on every material, exposure 1.25). **Change this ratio before
  reaching for any other visual fix**, because everything else is measured
  against it.
- **SSAO is ON at `high` only** (`ssaoOn = q === 'high'`; 12 taps on desktop,
  8 on a phone). It reads the scene pass's own depth attachment
  (`postfx.sceneRT` carries an integer `DepthTexture`, filled for free), runs
  half res, and multiplies BEFORE bloom. It first shipped off because it halved
  street value (street 0.156 -> 0.076). That was three bugs, not a strength
  problem:
  1. **Face the depth normal toward the camera, not toward +Z.** `n.z < 0 ? -n : n`
     is only right for a level or down-pitched view. Pitch up a degree and open
     ground's normal flips into the road, and every nearer ground sample is an
     occluder: street, shopfront and facade (all looking slightly up) lost about
     half their value, residential (looking down) 9 %. Face by `dot(n, P) > 0`.
  2. **"Is this sample buried?" is decided by pixel rounding at grazing angles**
     (one road pixel 20 m out spans ~0.35 m of depth). It is a horizon-style
     estimate over the points actually drawn instead: sine of their elevation
     above the tangent plane, squared (a 30 cm step barely counts, a wall does),
     times a `1 - d²/R²` falloff. Depth reads snap to texel centres.
  3. **The bilateral blur rejected nothing**: `exp(-|dz| * 0.02 / (1 - z))` is
     `exp(-0.02 * dd/d)`. It weights by linear relative depth now (sharpness 12).

  **Occlusion is gated to 0.7-1.2 m above the tangent plane.** Pavements stand
  0.45-0.9 m proud of the terrain beside them (lifts plus chord error), and
  scored honestly they drew a dark band along every verge. Cars, walls and
  building bases survive the gate; kerbs and paved lifts do not, so AO sees no
  under-car clearance and no window reveals (those are normal-map only). The
  composite takes a multi-bounce fit (Jimenez 2016, frame luminance as albedo),
  because AO multiplies sunlight too here and bright pavement must not dim.
  Radius 2 m growing with distance to 3x, fade 90-220 m, strength 14.

  | lower-half median (`values.py`) | AO off | AO on | shadowQ off | on |
  |---|---|---|---|---|
  | street | 0.1567 | 0.1555 | 0.0322 | 0.0295 |
  | shopfront | 0.1731 | 0.1679 | 0.0475 | 0.0449 |
  | facade | 0.1085 | 0.1081 | 0.0170 | 0.0168 |
  | residential | 0.1339 | 0.1315 | 0.0540 | 0.0509 |
  | downtown | 0.0639 | 0.0612 | 0.0280 | 0.0266 |

  Open-road smudge (pixels darkened > 4 %) on the street carriageway crop went
  53,360 -> 31 of 53,550. Cost: 3 half-res passes (AO + 2 blur), 17 depth taps
  per AO pixel (13 on a phone), no draws. **Judge it off vs on in ONE boot**,
  so traffic and frame are the same, and reset every uniform to its default
  between configs: one config's setting leaking into the next made two
  different settings measure identical for an afternoon.
- **Dither belongs in the output pass, not in the sky.** Baked into a sky
  texture it magnifies across the screen as clumped grain, shows up on the water
  as well, and pollutes the IBL the same texture feeds. It is screen-space,
  +/-1/255, after tonemap.
- **The grade split-tones by luminance.** Lifting blue across the whole range and
  then warming the whole range back cancelled itself. Highlights push toward
  amber (+0.022, +0.008, -0.018 above ~0.42) and shadows toward sky blue
  (-0.014, +0.002, +0.020 below ~0.38). Arithmetic in the grade, no extra pass.
- **Per-building colour varies TONALLY, in families.** Jittering R, G and B
  independently manufactures a candy palette; jittering one base colour per style
  instead produces a whole downtown of the same beige. `tint()` shares its
  brightness jitter across channels and pulls toward grey, and
  `buildingFamily()` picks one of eight named families weighted by height.
  **A family needs its own MATERIAL, not just its own tint.** With one wall
  texture, concrete, stucco and red brick were three values of the same thing
  and a street of five families still read as one stone -- no tint can turn
  ashlar into a running bond. `masonrySurface()` is parameterised and called
  twice, for stone and for brick.
- **One material for every wall, and the tiling is what makes that hard.**
  `Builder.box` emits UVs running 0..n and leans on `RepeatWrapping`, and GL
  repeat wraps the whole texture rather than a sub-rect, so a naive atlas cannot
  carry a tiling surface at all. `facadeAtlas()` lays the families out in a
  HORIZONTAL strip one tile tall: V still wraps natively, so a 100 m tower's
  seven vertical repeats cost nothing, and only U has to stay inside a cell —
  which `box` does by cutting a face into one quad per horizontal repeat. Plain
  textures, plain UVs, no `onBeforeCompile` and no `sampler2DArray`: the same
  reason postfx.js is 8-bit throughout is the reason this route was taken over a
  shader one. It costs about 41 % more facade triangles (0.2 % of the frame) and
  saves 91 draw calls downtown.

  Everything that used to differ per material is baked into the maps, because
  one material has only one of each: `normalScale` into the normal's xy (three
  scales the DECODED vector then normalises, so pre-scaling by `ns / nsMax`
  reproduces the old value exactly), `roughness` and `metalness` into their own
  channels, and `envMapIntensity` into the AO channel — three's AO term
  attenuates the image-based light, which is the only thing env drove. Emissive
  spans a hundredfold (a lit shop sign against a lit office window) and survives
  anyway because the map is **sRGB-encoded**: the window lands on texel 31, not
  on texel 2.

  **Glass stays its own material.** It is the one facade whose look is mostly
  indirect SPECULAR, which is the part of `envMapIntensity` the AO channel can
  only approximate.

  Cells carry 8 px of wrap-padding — the cell's own opposite edge — so bilinear
  and the first three mips filter as if the tile repeated rather than pulling in
  the neighbouring family.
- **Quality is MANUAL ONLY, and it persists.** The adaptive ladder is gone,
  by explicit request: it watched fps with no idea why a frame was slow,
  demoted players after warps (the post-teleport streaming burst is CPU that
  a lower tier cannot help), and kept overriding a deliberate choice. The
  pause-menu picker is the single authority; the choice is saved to
  localStorage ('auto-quality') and restored at boot.
- **Tunnel interiors are drawn UNLIT** (the glow material), light baked into
  vertex colours: lamp pools every 18 m, walls lighter than the ceiling, a
  warm strip overhead. Sun-lit materials inside a bore sit in the shadow
  map's darkness and render near-black -- "you can't see anything" -- so the
  interior owes the sun nothing and reads the same at any depth.
- **Haze thickens with altitude** (fog density up to 3.2x by ~480 m). The
  streaming rings -- massing at 1.6 km, detail at 800 m -- are a crawling
  boundary from a plane, and no draw budget pushes them past a 6 km
  sightline; atmosphere hides them honestly. Past that, the far massing layer
  (see "Flying") stands in for every building the rings have not delivered,
  and the far roads for every road — supertile layers, not wider rings.
- **The fog was a stop darker than the sky it dissolves into.** three r160
  mixes fog AFTER `<colorspace_fragment>`, i.e. in the target's sRGB
  encoding, but when rendering into a render target it uploads `fogColor` as
  the LINEAR value of the hex (`getUnlitUniformColorSpace` converts only for
  the canvas). So `0xb9c3cf` reached the screen as ~`#7a8a9e`: slate, while the
  dome (which encodes its own output) shows the horizon as `#b9c3cf`. Distance
  went dark and met the sky at a band. Proof is one render: fog density 0.01
  turns the ground a flat slate under a pale horizon. `syncFogColour()` in
  main.js hands the shader the ENCODED value while postfx is on, and the plain
  hex when the scene draws straight to the canvas (`low`, or post switched
  off), where three converts it itself. **Call it after anything that turns
  postfx on or off.** Zero cost. On a three bump, check whether fog still
  comes after the colour-space conversion.
- **The haze takes the sun's side.** `HAZE_SUN` (world.js) multiplies the
  haze toward the sun (1.13, 1.06, 0.93: brighter, warmer, forward
  scattering) and away from it (0.95, 0.98, 1.04), blended by
  `(0.5 + 0.5 cos θ)²`. The sky dome applies it to its horizon band; the fog
  chunk (`installHeightFog`) applies the same blend to the fog colour, so a
  distant hill toward the sun dissolves into the bright side of the sky and
  one away from it into the blue side. The dome blends in linear light and
  the fog in encoded space, so the fog's multipliers go in raised to 1/2.2.
  The sun is fixed, so its direction is a shader constant, not a uniform
  (`UniformsLib` is copied too early to extend, see the height fog). The
  vertex varying is now the world-space ray from the camera (`vFogRay`); it
  is linear in position, so the interpolated value is exact per fragment.
  The fog chunk declares `fogCol`; anything mixing toward the fog after
  `<fog_fragment>` (the far massing and far roads fades, the vehicle glass's
  premultiplied correction) must use `fogCol`, not `fogColor`, or it leaves a
  seam on the sun side. Cost: a normalize, a dot and a mix per fogged
  fragment, no draws, no uniforms.
- **Clouds have edges.** The cover ramp was `smoothstep(0.50, 0.74)` over two
  taps, which made every cloud an airbrushed smear. A third, finer tap
  (`uv * 9.7`) erodes the density by +/-4.5 %, which only matters where the
  threshold is being crossed, and the ramp is 0.53-0.69: cumulus with a broken,
  defined edge. Thick cores go grey underneath (`(dens - 0.62) * 1.6`, steeper
  sunward gradient 10, `cloudDark` 0x7f8b9b), so a bank has a lit side and a
  shaded base. The zenith/mid stops are a little less cyan (0x33609a /
  0x7398c2), and the grade's ACES saturation payback is 1.32, down from
  1.45: at 1.45 the sky, the lawns and the paint all sat at one shouting
  intensity. One more texture tap per sky pixel; the IBL is rendered from the
  same function once at boot.

## Shadows: snap the box, fade its edge

**Shadow crawl was the shadow box moving by sub-texel amounts.** The sun and its
target were re-centred on the player every frame by whatever fraction of a
texel they had moved, so the map was rasterised at a new sub-texel phase every
frame and every shadow edge in the city crawled as you walked or drove.
`placeSun()` in main.js projects the box centre onto the shadow camera's right,
up and forward axes (built once with `Matrix4.lookAt` from `SUN_OFFSET`, the
same basis three builds per frame), rounds each to `shadowTexelM` (2S/mapSize)
and rebuilds the position. A move then redraws the same map shifted by whole
texels. **Depth is snapped too**: it moves no texels, but it shifts every stored
depth by a fraction and the PCF compare flips on a grazing roof.

Measured with the camera held still and only the shadow centre moving, reading
the scene pass from `postfx.sceneRT` (before post, so dither is excluded), a
pixel counted when any channel moves > 3/255:

| churn per step | 5 cm before | after | 2.3 m before | after |
|---|---|---|---|---|
| downtown street | 0.125 % | **0.000 %** | 0.164 % | **0.000 %** |
| commercial street | 2.180 % | **0.000 %** | 4.560 % | **0.001 %** |
| houses | 0.682 % | **0.000 %** | 1.612 % | **0.000 %** |

**Rotation must not enter the box.** `SUN_OFFSET` is fixed, so only translation
needs snapping. If time of day is ever added, the basis has to be rebuilt and
the map re-rasterises while it turns: rotate in discrete steps, or accept the
swim while the sun moves.

**The box edge fades.** Past the ortho box three returns "lit", a hard line that
slid across the street as you turned, because the box follows the view.
`installShadowFade()` patches `shadowmap_pars_fragment` to fade shadowing over
the last 7 % of the box (~36 m at desktop's 260 m half-width, ~27 m at the
phone's 190 m). It is a string replace pinned to r160: it warns and leaves the
chunk alone if the text changes, so **re-check it on a three bump**.

### Smooth edges, and the player's own map

**"When you're walking, the shadow is not a solid shadow, it has weird lines
in it."** Not a regression: three long-standing things, all visible in
`docs/shadows/`:

- **The phone filtered with plain PCF.** Chosen as "a fraction of the cost"
  of PCFSoft, which is not what three r160 does: PCF is 17 compares at
  nearest-texel offsets of 0, +-0.5 and +-1 texel, PCFSoft 16 compares
  weighted bilinearly by the sub-texel position. Same fetches. What PCF buys
  is a fixed tap pattern, so every shadow edge is a stair of nested
  rectangles one texel a step -- 0.37 m at the phone's 1024 map over a 190 m
  box -- and a small caster is a stack of concentric boxes. Every device now
  uses PCFSoft.
- **A person is one texel wide in the sun's map.** The body is ~0.45 m
  across, a leg ~0.12 m, the texel 0.37 m (0.25 m on a desktop). No filter
  can draw a caster smaller than its texel: the walking player's shadow was a
  blocky smudge whose legs came and went as they crossed texel centres. So
  **the player has a map of his own** (`src/nearshadow.js`): the same sun
  direction, a box 4 m either side of him (more for a long vehicle: half its
  length + 2.5 m), 512 texels -- 1.6 cm a texel on foot. The box only has to
  hold the CASTER: every ray through a shadowed receiver passes through it,
  so in the light's xy the whole shadow lies inside the caster's outline; its
  depth runs 40 m up-sun to 200 m down-sun, so a jump or a fall off a pier
  still lands its shadow. Casters: the player on foot, or the vehicle he
  drives on the ground or water (not an aircraft, the balloon or a train,
  whose shadows land far from them; those keep the sun's map).
- **Your own car cast only its wheels.** A parked car's body has its casting
  switched off (traffic.js: its shadow lands on shaded kerbside ground), and
  traffic's per-car loop, which switches casting by distance on a phone,
  skips the player's vehicle; so a car taken from the kerb drove off casting
  only the four detailed wheels `setDetailed` adds, on every device.
  `setDetailed(true)` now switches its body's casting on: +3 shadow draws
  while you drive a car taken from the kerb, the body's three parts.

How it is wired, and the laws that come with it:

- **The casters leave the sun's map for the frame** (hidden for the inner
  `shadowMap.render`), and every lit material takes `min(sun, near)`: the
  darker of the two, never the product, so the player's shadow falling into a
  building's adds nothing, as a real one would not.
- **three sees a second shadow-casting DirectionalLight**: that is the only
  way the map, its matrix and the shadow coordinate reach every built-in
  program (`UniformsLib` is copied too early to extend, see the height fog).
  `installNearShadowChunk` patches `lights_fragment_begin`'s directional loop
  to light with index 0 only (the sun) and fold index 1's shadow into it; the
  near light's colour is 0 anyway and it never lights anything. **Light
  order is the scene's**: the near light is added straight after the sun,
  both cast, neither has a map, and three's sort is stable. **There is one
  sun**: the patch compiles out every directional light past index 0, so a
  second real directional light would silently go dark -- change the patch
  first. It is a string replace pinned to r160 and refuses (warns, adds no
  light, the player keeps the sun's map) if the chunk changed: **re-check it
  on a three bump**. `window.__noNearShadow` boots without it.
- **The map is drawn by three's own shadow pass**, called with the near light
  alone and a stand-in root holding only the casters: 1 draw on foot, a car's
  three parts and its wheels in one, no walk of the scene. It wraps
  `shadowMap.render` OUTSIDE shadowcache.js and chunkcull.js (installed
  after both), so they see only the sun, exactly as before; a render of any other scene (one without the near light) passes
  straight through. With nothing to cast it renders one empty map and parks
  the light 100 km under the world, so every receiver falls outside its box
  and `getShadow` skips its taps.
- **Biases are for the near map's own scale**: ~5 cm along the ray and one
  texel along the normal (a car's curved panels must not shadow themselves
  in a 2-4 cm map). The sun's -0.0006 is ~0.6 m at its 960 m depth range,
  which is why cars never shadowed themselves there. A pedestrian's material
  still lifts its lookup 0.6 m toward the sun in BOTH maps (peds.js), so the
  player still does not self-shadow.

Cost, phone profile (iPhone UA and viewport, Mac GPU): one more pass (the
casters' own draws, moved out of the sun's) into a 512 x 512 map (~2 MB of GPU: RGBA + depth), every lit program
built for two directional shadow maps (one more `mat4` and varying per
vertex, one more sampler, one more `getShadow` whose taps run only inside
the player's 8 m box), PCFSoft's mixes instead of PCF's 17th tap.
Measured on the phone profile, in one boot where it could be (the near map
switched off and on, or the light's casting off and the filter switched):

| | before | after |
|---|---|---|
| near pass, CPU (Mac, unthrottled) | -- | 0.024 ms a frame, 1 draw on foot |
| GL calls a frame, frozen frame | 1137 | 1144 |
| shadow-pass draws (perfcpu foot-dt / drive-dt) | 7-10 / 13 | 4-10 / 13-14 (the player's draw moves, it is not added) |
| scene + shadow GPU, chase view, median of 80 (2 rounds) | PCF 3.38 / 3.19 ms | PCFSoft 3.35 / 3.72, + own map 3.67 / 3.11 ms |
| GPU memory | | + ~2 MB (512 x 512 RGBA + depth) |

The GPU medians are inside each other's spread: PCFSoft against PCF and the
extra map do not show on the Mac at the phone's 1267 x 582. perfcpu at 8x
on this machine (another agent's load, 4-5) moved every system together
between runs, base and branch alike (render 10.8-21.3 ms base, 11.1-28.8
branch over two alternated rounds), so it can say no more than that nothing
large moved; the near pass's own 0.024 ms is about 0.2 ms at 8x.

`docs/shadows/`: `walk-side-steps.jpg` (PCF, PCFSoft alone, PCFSoft and the
player's map: the filter smooths the stair, only the map gives the shape),
`walk-side.jpg`, `walk-top.jpg`, `walk-side-full.jpg`, `car-side.jpg`,
`car-chase.jpg`, before | after.

`tools/shadowshots.mjs` shoots the walking player's shadow (chase, low side,
from above, with crops), the player's car, and building shadows across two
streets downtown and two among houses, phone profile by default
(`--desktop`), the game's own sun (`placeSun`); `SHOTS_EVAL` switches an
experiment on in the same boot (`d.nearShadow.on = false`).

## Surfaces: glass, windows, roofs, trees, ground

**Glass reflects the sky, pane by pane.** A vertical mirror seen level or from
above reflects the IBL's ground half, so every tower read as dark blue paint.
The glass material alone re-includes `envmap_physical_pars_fragment` with the
reflected ray folded into the upper hemisphere (`y = abs(y) * 0.85 + 0.12`),
and a per-pane hash tilts the normal up to ~2 deg for a curtain wall's
patchwork. Glass is metalness 0.58, env 1.15.

**Masonry windows carry per-window state and real reflection.**
`packedCell(..., winMetal)` bakes metalness 0.6 and full env into the glazing
texels of the stone and brick cells — glazing is the only content under ~0.3
roughness there, so no second map. `metalMax` is 0.6 (industrial's 0.25 rides
as 0.25 / 0.6). The facade shader hashes window column, storey row and building
into a dark room, blinds or a cold pane, and **divides the building tint back
out of the glazing**: a metallic pane takes F0 from albedo, so on brick every
window mirrored the sky in red.

**A per-building hash must not read vertex colour VALUE.** `Builder.box`'s baked
AO scales the tint toward the ground, so vColor changes continuously up every
wall, and hashing it through `fract(sin(...))` re-rolled every window per
PIXEL: blue-white static on every masonry facade. Seed from the tint's channel
RATIOS (quantised r/g and b/g), which a uniform scale leaves constant under
interpolation. Anything hashing per-building state out of vertex colour has the
same trap.

**Every lidded roof drew a flat deck 2 cm under its lid, and 93.8 % of
non-house buildings carried it** (62,576 of 66,743). One 24-bit depth step at
near 0.5 is `z^2 / (0.5 * 2^24)`: 0.48 cm at 200 m, 1.91 cm at 400 m, so from
~400 m out the two tops share a step and every low roof in an aerial z-fought.
The deck is skipped where a lid exists, and the dark parapet sits at w+0.75 so
it clears the kit's parapet (w+0.5) by 12 cm, not 2.5. Roofs take their own
`roof` atlas cell (seams, ponding, patches, drains) at 10 m a tile. **Any two
coplanar-ish tops need more separation than one depth step at the farthest
distance they are seen from**, not at street level.

**Trees are lit volumes**: a broadleaf crown is a core and clumps over its
upper surface, a conifer stacked skirts brightening toward the leader, and the
foliage on the sun's side (`SUN_OFFSET`) goes yellower, so the crown reads as
a volume at any heading. How they are planted and drawn -- records, three
levels of detail -- is "A green Seattle" below; `meshCanopy`, which merged
~300 vertices per tree into the chunk, is gone.

**The ground map is sampled at three scales.** One 13 m tile was the whole city
floor: blurry underfoot and a visible grid from the air. `buildTerrain`'s
`onBeforeCompile` adds 75 m macro patches and 3 m grain, each normalised by the
map's mean (0.44 linear) so the average value does not move. `SUBURB` is
`[0.47, 0.53, 0.38]` — GRASS's hue at low chroma; `[0.52, 0.53, 0.41]` came out
khaki dirt after ACES and the grade. It must stay distinct from GRASS (see the
I-5 trench fix). Water takes a second normal tap at -0.29x the scale drifting
the other way, blended in tangent space, which breaks the 16 m tile weave into
longer swell. `GRASS` is `[0.40, 0.57, 0.29]` and park lawn `[0.40, 0.60,
0.31]` (were `[0.42, 0.62, 0.28]` / `[0.42, 0.66, 0.3]`, which read as an
emerald putting green in every park).

**Water is a dark body under a chop map.** The normal map was 900 ellipses
30-180 px long and 2-7 px tall, all within +/-0.2 rad of horizontal: every one
a streak the same way, magnified 3.4x again by the second tap, so the bay read
as brushed metal. `waterSurface()` is now ridged, domain-warped value-noise
fBm (lattices 6/12/24/48 per tile, all wrapping; ridge `1 - |2n - 1|` squared
for sharp crests and broad troughs; the warp evaluated on a 64² grid and
upsampled), normal by wrapped central difference: irregular wind chop, ~20 ms
on a desktop, once per build (the boot cache keeps the PNG). **A sum of sine
trains was tried first and is worse**: to tile, the wavevectors must be
integers, so the long ones can only point a few ways, and 20-64 of them weave
into plaid. The body colour went from `0x33556e` to `0x0a1d22` with env 1.4 ->
2.0 and normalScale 0.36 -> 0.24: sea water scatters almost nothing back, and
the old blue body, lit like Lambertian plastic by the 4.3 sun, was most of
what the near water showed. Now the crests carry the sky and the troughs go
dark. (Darkening the body alone, with the old map, changed almost nothing
visible: the streaks were the problem.) The lakes and the canal clone the sea
material, so they follow.

**Foliage is shaded as a volume.** `Builder.foliage()` (crowns) and
`cone(..., shade)` (fir tiers) replaced `spheroid`/`cone` in the old
`meshCanopy`, and trees.js's `lobe()` keeps the idea for the instanced crowns:
normals are smooth per corner and bent 55 % toward the normal of the WHOLE
crown (from its centre), so a tree shades as one mass with a lit shoulder and
a dark underside instead of five faceted balls with a hard terminator across
each; colour is darkened toward each lobe's bottom (`shade` 0.22-0.42, baked
self-occlusion) and mottled +/-16 % per corner, hashed from position, which
interpolates into clumps. **`spheroid`'s bottom cap is open**: its first ring
passes the two pole corners (`tri(b, a, d)` with a, b both at the pole), a
zero-area sliver, so from underneath every canopy showed the backfaces of its
top -- the dark "spikes" in `docs/gfx169/tree-close.jpg`'s before. `foliage`
builds a real fan. `spheroid` itself is unchanged (vehicles, characters and
props use it and their geometry is cached); fix it there separately if
anything else is seen from below. Same triangle count, 0 draws; `Builder.tri`
now takes per-corner normals and colours like `quad`.

**Car paint is clearcoated on a desktop only.** `paintMaterial` returns a
`MeshPhysicalMaterial` (metalness 0.35, roughness 0.42 under clearcoat 1,
clearcoatRoughness 0.06) unless the user agent is a phone: the sky lies across
the panels as a sharp band over a colour that stays saturated, where the one
0.26-rough semi-metal gave a single blurred sheen. It is a second specular
lobe per paint pixel, so the phone keeps the one-layer material (and the far
LOD's `FAR_PARTS` copy of it). Same three draws; the warm-up's sedan compiles
the physical program on a desktop.

## Judging how it looks

Four separate visual bugs were each diagnosed two or three times as something
else, because the thing doing the judging was wrong. The rule that came out of
it: **measure the composited frame, and check the harness before the renderer.**

**A check that re-derives its own answer measures the map, not the game.**
`tools/jank.mjs` had two of these. `tree-in-water` re-implemented the scatter's
filters and counted the points that passed — which is a property of the rasters
and never changes, so it reported an unchanged 16 before and after the scatter
was fixed and could not have detected its own fix in either direction. Against
the trees that actually get planted the real figure was **63**. `roof` had the
same shape, and a first attempt at fixing it made things worse rather than
better: the check was changed to ask the mesher's own `World.gables()` guard,
which made the condition `aspect > 4.5 && aspect < 4.5` — a tautology that
reports 0 however the mesher behaves. **If a check and the code under test each
hold their own copy of a threshold, the check is decorative; if the check asks
the code under test whether the code under test did its job, it is worse than
decorative.** `tree-in-water` now reads `city.obstacles`, the record
`buildChunk` writes as it plants each trunk.

**The `roof` check was deleted, because its defect did not exist.** It counted
footprints more elongated than 4.5:1 — a threshold invented in the check and
never checked against `meshGable`, which sizes eaves from the actual `w` and `d`
(a fixed 0.45 m overhang) and runs the ridge along the longer side. Measured on
the three footprints it named, contiguous roof past the narrow wall was 0.4 /
6.0 / 5.8 m with the gable built and 0 / 6.0 / 5.8 m with it **suppressed** —
the metres are neighbouring terrace roofs, which touch and cannot be separated
by contiguity. A guard was briefly added to skip gables on elongated houses;
that was a regression on three correct terraces, and is reverted.

**Settle the streamer before raycasting anything.** Chunk geometry is
time-sliced, so one `world.update` builds a few milliseconds of it and returns.
Querying straight after measures a half-built city: every worst-point diagnosis
came back `drawn: null` because the road mesh did not exist yet. Note
`world.update`'s `budget` argument is **not** a millisecond budget — it is read
only as a `< 2` flag and the function then picks its own 2/4/9 ms slice — so
settling means calling until nothing is pending (~243 calls cold, ~126 for a
neighbouring site). Settling is far too expensive to do per sample: work
site-by-site, settle once, then take every sample inside the built area.

**`city.obstacles` is a flat stride-3 array** (`x, z, r, x, z, r, …`), one per
chunk — not a list of objects. Iterating it as objects matched nothing and
reported a clean `0 of 0`, which is the most dangerous possible result: a green
number that means "measured nothing at all". Always check the denominator.

`tools/beauty.mjs` captures a fixed set of framed views; `tools/values.py`
reports the linear value structure of the resulting PNGs -- percentiles, the
median of the lit and shadowed quartiles, and the ratio between them. A daylight
open world of the target era runs a lit-to-shadow ratio of roughly **2.2-3.3:1**.
At 13.8:1 the shadows are night values under a daylight sky, and no amount of
albedo tuning fixes it, because every base colour is being multiplied by an
ambient term near zero.

**Measure the PNG, not the scene pass.** `renderer.render(scene, camera)` in a
probe skips the whole post chain, and AO, grade and vignette are a large part of
where the values land. A probe that renders directly reported a shadowed
quartile of 0.19 for a frame whose actual pixels were at 0.004 -- a factor of
fifty, in the direction that hides the bug.

**The harness lights the shot, so the harness can be the bug.** `beauty.mjs`
used to place the sun relative to the camera and aim it at the LOOK-AT point.
That is fine for a shot 20 m deep and badly wrong for one 2400 m deep: the
skyline view ended up with the light 240 m above a target 2400 m away, a sun
**5.7 degrees above the horizon**. Every up-facing surface in the aerial got a
tenth of the key and the mid-ground rendered as a black band. It reproduces
main.js's own `(-215, 200, -150)` offset now. Same class of error as the stale
shadow map in `survey.mjs`.

**Spawning is not placing.** Traffic and pedestrians set their logical position
on spawn; only each system's `update()` moves the meshes. The beauty shots pause
the game so the camera can be flown, so for several passes they counted a dozen
vehicles in the frustum and drew none of them. Seed, then step the systems.

**Frame the views from the map, not from coordinates.** Hardcoded camera
positions went stale the moment the city became real data -- the shot named
`park` contained no park and `residential` framed an office block, so vegetation
and housing were never actually being looked at. The views resolve at capture
time from the loaded city: densest cluster of `style === 'house'`, densest
cluster of buildings over 60 m, the fully-green patch nearest downtown.

### Four bugs that all looked like a material problem

- **A shadow with no bottom is the shadow map running out.** A tower's shadow
  was sliced off mid-facade in a straight vertical line. The ortho box was 190 m
  and shadowing simply stops at its edge. The proof is one render: widen the box
  and previously *lit* pixels go dark. No real shadow gains area when you
  enlarge the camera that draws it.
- **Vertex tint multiplies the windows too.** Glazing drawn at `rgb(36,48,58)`
  and then multiplied by a red-brick family colour lands at `(29,18,16)` --
  black holes, on brick buildings only. Panes start bright now, which is also
  what a daylight window actually is: mostly a reflection of the sky.
- **Banding in the sky was the cloud generator.** 390 ellipses squashed to about
  a fifteenth of their width at 3-11% alpha are individually invisible and stack
  into continuous horizontal streaks across the equirect. It was twice blamed on
  dither and precision in the post chain. (The painted equirect is gone now —
  the dome's clouds are fBm — but the diagnosis generalises.)
- **A canopy built from `prism` has no top or bottom.** `Builder.prism` is an
  open drum, so a squashed one seen from eye level is a single band of vertical
  wall -- the "green slab on a stick" that trees rendered as. `spheroid` is
  closed and costs about the same.

## Draw-call budget

At `high`, perfguard's downtown reads roughly 165 steady draws and ~285 a
frame, ~1.18-1.19 M triangles a frame (the spread is how much traffic spawned
that boot, not the build). Steady draws fell from ~220 when the landmarks were
split into culled clusters (see "Landmarks"). Triangles are up on the
pre-import city because the building density is real; draw calls are not.
Flying adds 10-20 draws for the far massing layer and 6-9 for the far roads
(see "Flying"). The mountain band is one more, always (see "Mountains on the
horizon").
`__dbg.sceneStats` reports the scene pass specifically — read `renderer.info`
yourself and you'll get the post chain's fullscreen quad instead, because the
counters reset on every `render()`.

Where the budget goes, and the rules that keep it there:

- chunk streaming: `CHUNK = 400`, `NEAR_R = 2` (full detail), `MID_R = 4` (roads
  only). Up to 6 merged meshes per near chunk: road, sidewalk, flat, glow, glass
  and **one for every other wall material**. Stone, brick, industrial, house and
  signage used to be five meshes and were 115 draws downtown for 25k triangles —
  216 triangles a draw, on a target where the draw calls are what bind. They
  share one atlased material now; see "One material for every wall" below.
- **vehicles are 3 draws each** — `paint` / `trim` / `matte`, sharing geometry
  and the two non-paint materials across every instance. Traffic uses the
  `…GeoW` variants with the wheels baked in; only the player's car calls
  `setDetailed(true)`, which swaps to the wheel-less geometry and adds four
  articulated wheel groups. Glass stays inside `trim`, so see-through cabins
  added no draw (see "Vehicle glass is see-through"). Traffic averages ~6,800
  triangles a vehicle (weighted by `CIVILIAN_TYPES`; the bus is +22 % on its
  pre-cabin 8.1k, planes ~1.5k). `import('./apps/auto/src/vehicles.js')` in
  Node and read `vehicleAssets().types[k]` index counts — no browser needed.
- **on a phone, vehicles past 60 m are instanced** (`traffic.updateFarLod`):
  one InstancedMesh per type over `farLod(type)`, the three part geometries
  merged and vertex-clustered at 20 cm (~35 % of the triangles), paint tinted
  per instance and masked per vertex (`lodA`). Instances are frustum-culled
  per car on the CPU, because an InstancedMesh culls as one object. Desktop
  (`FAR_LOD` Infinity) is unchanged, and nothing that casts a shadow
  (`SHADOW_NEAR` 45 m) is ever instanced. Judge it at telephoto against the
  full meshes in one frame: from 60 m they are near-identical. **The
  handover back is where a car vanishes** if its own world matrices were
  never composed (a frozen parked car; see "The scene graph's own cost"):
  judge it with verify under `AUTO_PHONE=1`, never on desktop, which has no
  handover.
- **landmarks are clusters**, merged by material within ~1.2 km and culled on
  their own bounds: 100 draws and 68k triangles for all of them, but only the
  clusters in view are paid for.
- **characters are 1 draw each.** They're `SkinnedMesh`es over a pool of 12
  shared geometries (`variants()`) plus 4 for cops (`copVariants()`), ~4.4k
  triangles each, so per-instance cost is a skeleton, not a buffer. **Never
  dispose a pooled geometry** — `makeHumanoid` returns a
  `dispose()` that no-ops unless the character was built `unique`, and
  `PedSystem.remove` must go through it. Disposing it directly yanks the GPU
  buffers out from under every other pedestrian wearing that look.
  Their contact shadows are ONE more draw for the whole crowd and the player
  (an InstancedMesh, see "Characters: head, hands, hood").
- every tall building in the whole city is one static "far skyline" mesh.
- **terrain is 6 x 6 tiles (one draw each) and far blocks are coarse.** Tile
  size trades draw calls against wasted triangles, and on a phone the draw calls
  are what hurt: 20 x 20 put 132 terrain meshes on screen at once, 12 x 12 still
  40-46 in a street view. Big tiles cull badly, which the LOD pays for: each
  tile draws 480 m blocks at stride 1 / 2 / 4 by camera distance, only blocks in
  the frustum keep a tile drawn, and the downtown frame went from 795k terrain
  triangles in 14 draws to 164k in 12. See "Far terrain is drawn coarse" in
  `performance.md`.
- parked cars only exist within `PARKED_RADIUS` and hide past 140 m (80 m on
  a phone, `PARKED_SHOW`). Lot parking adds at most 6 cars (+18 draws), only
  inside a lot.
- lots are drawn by the terrain shader: 0 draws, 0 triangles.

`roadLift()` is a 3×3-chunk edge scan, so **anything that samples the ground
more than once a frame computes the lift once and passes it in**: vehicles take
seven samples, the player two, pedestrians one. Calling `groundAt(x, z, y)`
without the 4th argument silently re-runs the scan.

## Mountains on the horizon

Seattle's signature views -- the Olympics over the Sound, Rainier over the
south end of downtown, the Cascades behind Lake Washington -- were a flat haze
line. `src/mountains.js` is **one draw**: a 720 x 2 cylinder band around the
camera, built in `buildSky` right after the dome, painted from
`data/mountains.bin` (**real USGS 3DEP elevation**, public domain, through the
terrarium tiles `fetch_dem.py` already uses; `tools/build_mountains.py`
re-bakes it, 193 KB, tiles cached in `tools/data/dem/`).

- **It is a sky element, on purpose.** Same vertex trick as the dome
  (`mat3(viewMatrix)`, `z = w`), so it never parallaxes, never meets the far
  plane, and a plane at any altitude sees it infinitely far. It sits at
  `renderOrder -999` with depth test and write off, so every building, hill,
  island and wave paints over it and the SSAO sky test still sees depth 1.0.
  **Not `transparent`**: that would sort it after the whole opaque scene and
  paint it over the city. `CustomBlending` (src alpha) keeps it in the opaque
  list; its destination alpha is left alone so the target keeps the dome's 1.
- **The silhouette is the real skyline.** The tool marches a ray for each of
  8192 bearings (0.044 deg) from the origin (Westlake), 16-150 km out through
  the 104 m DEM (Rainier's sector again through the 26 m one), keeping the
  highest thing on the sky: its angle with the earth's curvature off (k = 0.13
  refraction), and a smoothed distance. The shader stretches angles by
  `EXAG` = 1.2 (Rainier 2.3 deg true, 2.7 drawn) and lowers the skyline by
  `camAlt / dist`, so from 1.5 km the range sinks toward the horizon.
  **The distance is smoothed on purpose**: the true one jumps between near
  hills and far ridges column to column, and everything below the skyline is
  shaded from it (height, haze), which made vertical bars. The angle itself is
  exact.
- **Rainier is a baked view, not a cone and not a mesh.** Seen from a fixed
  point (no parallax) a mesh and a picture of the mountain are the same thing,
  and a picture can hold what a few thousand triangles cannot: a 400 x 100
  RGBA texture where each texel is a ray cast at that bearing and elevation
  against the 26 m DEM until it hits ground, storing height, slope, **sunlit
  factor** (lambert against the game's fixed sun, with cast shadows) and
  distance. Foothills in front hide the lower slopes, Little Tahoma stands to
  the left of the summit dome, the Emmons and Willis Wall faces are in their
  right places -- none of it authored. Rows are in the same stretched-angle
  units as the skyline, so altitude is a texture-coordinate shift
  (`camAlt / rdist`). The window fades out at its edges into the procedural
  look, which is also what the rest of the range uses.
- **The look is derived, not painted.** Forest to bare rock to snow by true
  height, with **snow only where the ground is gentle enough to hold it** (slope
  < ~45-60 deg, noise-broken), so steep rock ribs stay dark; faces are lit by
  the baked factor on Rainier and by a normal tilted by the silhouette's slope
  elsewhere (tilt fades with depth under the skyline, or a column sharing one
  tilt reads as a bar). Olympic snow line 1450 m, the rest 1900. Haze is the
  dome's own horizon colour (same `haze`, `hazeToward`, `hazeAway` objects),
  `1 - exp(-d / 115 km)`, thicker toward the foot, and the foot is faded to
  that colour over `120 + 0.3 * camAlt` m: no base line and no gap from a
  plane (a hard bottom edge read as a floating strip at 1.5 km).
- **No parallax, deliberately.** Bearings are from the origin. Downtown,
  Kerry Park and Alki are within a couple of degrees; the map's far edge is off
  by up to ~17 deg for the nearest Olympic peaks. East of the map the real hills
  at 17-35 km (Cougar, Tiger) are in the skyline too, because the game's terrain
  stops at 15.6 km.
- **Cost:** +1 draw, 1440 triangles, a 32 KB and a 160 KB RGBA8 texture, no
  render target, nothing per frame but one uniform. Fragment work is only where
  the band is on screen and only below the ridge (above it: two taps and a
  `discard`). Judge it with `tools/viewshots.mjs` (`mt-*` views) and **look at
  the shots** against a photograph: dome summit, Little Tahoma on its left
  shoulder, the long right-hand slope.

## Far buildings take their real colour (v166)

**Massing boxes and the far skyline were two to three times brighter than the
buildings they stand in for.** They used per-style tints of 0.55-0.66 linear,
while a textured wall is its family colour x its tint x its atlas cell, and the
cells average ~0.4 (house siding 0.6, industrial 0.3, glass 0.3). So at the
800 m ring the city turned into pale boxes. `massColour(bd)` computes what a
building's textured walls average to (`buildingFamily` -> `tint` x
`CELL_MEAN[cell]`; houses through `paintTint` and `HOUSE_PAINT` like the near
mesher), and the mid-ring massing, the far massing layer (area-weighted per
merged cell) and the skyline all use it. Mid-ring roofs are membrane grey or
house shingle, not a darkened wall. **`CELL_MEAN` is measured off the atlas;
re-measure it if a facade surface's drawing changes.**

**The pavement verge's toe is the ground's colour.** It was a fixed grass
tint, ~1.6x the terrain beside it, which drew a pale line along every
pavement. `groundTint(x, z, y)` is the terrain's own vertex tint (extracted
from `buildTerrain`), and the toe takes it x `GROUND_MEAN` (the ground map's
measured mean), so verge and ground meet.

`tools/beauty.mjs` takes `BEAUTY_ONLY=a,b` (just those views) and
`BEAUTY_PROBE='<expr>'` (evaluated after each view is posed, with `d = __dbg`).
`docs/gfx166/` has before | after shots of this and of the ferry.

## A phone-neutral graphics pass (docs/gfx169)

The brief was "look better, cost the iPhone nothing". Everything landed
inside existing shaders, textures and vertex data; the details are under
"Rendering pipeline" (fog colour, sun-side haze, clouds) and "Surfaces"
(water, foliage, paint). What was measured:

- **Draws and triangles are identical.** The full `beauty.mjs` set's last
  view reads 424 draws / 1,788,519 triangles before and after; perfguard
  downtown 216-220 steady draws on both (traffic spawn is the spread).
  No new render targets, passes or uniforms.
- **The phone path's extra work is ALU only**: per fogged fragment a
  normalize, a dot and a mix (sun-side haze), one more cloud texture tap per
  sky pixel, and the water's (same-cost) material. The phone keeps the
  one-layer car paint; only a desktop UA gets the clearcoat lobe.
- **CPU at the 8x throttle is unchanged within noise** (perfcpu,
  phone profile, interleaved runs on a machine shared with other agents):
  render 9.95-10.33 ms master against 8.31-10.78 ms branch over two pairs;
  every system moved together between runs, i.e. it was the machine.
- **Boot:** the water map is computed now instead of painted, ~20 ms on a
  desktop (Node, same V8). The whole of `buildTextures()` timed in-page read
  270-430 ms on both builds -- the difference is under the noise -- and it is
  first launch of a build only, since the boot cache keeps the PNG.

`values.py` moved where intended and nowhere else: waterfront median
0.121 -> 0.076 (dark troughs; its "shadow ratio" is now the water's, not a
shade), park median 0.213 -> 0.194 and saturation 0.398 -> 0.331, skyline p95
0.364 -> 0.438 (the haze reaching the sky's value); street, shopfront,
facade, residential and downtown within 0.01.

A fixed-rubric judge (1-10 against a modern open-world city, same rubric and
the same eight views, scored before, mid and after) put the mean at 4.1 ->
4.5 / 4.3: water 4 -> 5-5.5, sky 4.5 -> 5, lighting 4 -> 4.5, grade 4 ->
4.5; roads, facades and building variety did not move, and vegetation stayed
at 3 -- smooth-shaded low-poly crowns are better, but the judge's ceiling
there is alpha-card foliage, which is overdraw and a new material the phone
should not take. Its other repeated asks (SSAO-style contact darkening at
street level, road wear, window depth) are the next candidates; SSAO
already runs at `high`, gated to 0.7-1.2 m occluders, which is why it cannot
darken kerbs.

**Harness notes from the pass.** A variant harness that boots once and
shoots N live settings per view (camera, materials, a recompiled shader via
`material.fragmentShader = ...; needsUpdate = true`) made every choice here a
same-boot A/B; settings carry over from one view to the next unless each
variant resets them. Two harnesses on one CDP port hijack each other's page
(the second navigates the first's tab mid-run): one port per run.

## A green Seattle: trees as records, three levels of detail

**Seattle is ~28 % tree canopy and it read as a treeless grey grid.** Each
tree was full merged geometry (`meshCanopy`, ~300 vertices), so a chunk could
afford ~47 of them: Discovery Park's forest was a golf course, there were no
yard trees, street trees were a lamp-post alternative every ~65 m, and past
the 1 km detail ring -- the top half of every aerial -- there were none at
all. A tree is now a **record** (`trees.js`, `REC` floats: x, ground, z,
height, crown radius, kind, seed, tone, trunk index) drawn at three levels of
detail, **each built inside the level above it**: where a finer level draws,
the coarser one is hidden in it, so nothing is swapped, faded or popped.

| level | which trees | shape | cost |
|---|---|---|---|
| far | every tree of every streamed chunk, near and mid ring | merged into the chunk's flat mesh: a 6-sided bipyramid on a 3-sided trunk (15 tris), a 6-sided cone (9) | 0 draws, culled with its chunk |
| mid | within `R1` 300 m (phone 220) and in view | one `InstancedMesh` per species: a core and five clumps (134 tris), three skirts (34) | 2 draws |
| near | within `R2` 95 m (phone 70) and in view | a core, twelve clumps and three boughs (372), seven drooping skirts with undersides (152) | 2 draws |

- **The instanced sets are chosen on the CPU, rarely.** `TreeSystem.update`
  (main.js `draw()`, before the scene pass) walks the records by 50 m cell
  against the camera's frustum -- each cell's sphere grown by how far the view
  can turn or slide before the next choice -- and only when the camera has
  moved 10 m or turned 9 degrees. Cells within 70 m are taken whatever the
  frustum, since their shadows fall into view. The meshes are not
  frustum-culled (their sets already are). 0.1-0.3 ms a refresh on the Mac;
  below the top 40 of an 8x profile.
- **The instance colour is the foliage's albedo, not a tint of the tree.**
  A per-vertex `leaf` flag mixes it in, so trunks keep their bark. Sunlit
  foliage goes yellow-green (`leafLight`): the far crowns bake it per vertex in
  world space, the instanced ones compute it from the turned normal -- one
  formula, so a tree keeps its hue across levels.
- **An instanced mesh's fog ray needs `instanceMatrix`.** `installHeightFog`
  built `vFogRay` from `modelMatrix * transformed`, which fogged every
  instance -- the trees, and the phone's far traffic all along -- as if it
  stood at the map's origin. Fixed for every instanced mesh.
- **Shadows**: the near crowns cast everywhere, the mid ones on a desktop.
  The far crowns ride in the flat mesh, which casts on a desktop only, as
  before. On a phone the near crowns are movers in the shadow pass (+1-2
  shadow draws): re-chosen as you move, they cannot join the shadow cache.
- **A tank still fells them**: the trunk's obstacle entry goes to 1e9 and
  the far crown's index range is hidden (`_fell`), as for a lamp post; the
  refresh skips a record whose trunk is felled (tank.js calls
  `world.trees.invalidate()`).
- **The program compiles behind the loading screen**: `world.trees.warm`
  draws one degenerate instance per tier in the warm-up frames ("Hitches").
  An empty tier is hidden, not drawn with no instances.

**Where they stand** (`plantTrees`, per chunk in `buildChunkStep`, sliced like
`meshProps`; deterministic by hash, so a rebuilt chunk plants the same trees):

- **Forest** on the wood mask (surface.png blue, `tools/build_wood.py`, see
  "Where the map comes from"): a jittered 9 m grid, 90 % filled, stands of
  20-70 % fir by a 240 m noise field -- fir 18-35 m tall, maple and alder
  14-24 m, a little understorey.
- **Park lawn**: groves from a 150 m noise field, and +40 % within 14 m of
  the park's edge or a shore: Seattle's parks are ringed with trees and
  mown in the middle (Green Lake's path). Pitches and beaches
  (`G.GREEN_OPEN`) get none.
- **Street trees** on both kerbs of `res`, `st` and `art` streets every
  10-12 m, filled by class x a 520 m "leafiness" field (blocks differ, as
  Seattle's do): past the pavement and its verge on a residential street;
  where a building, lot or drive meets the pavement -- and always on an
  arterial -- in a grate 1 m in from the kerb, clear of every slot of
  `meshProps`' kerb furniture. **That cascade's tree branch is empty on
  purpose**: deleting it would hand its hash band to the hydrants. The
  junction margin applies only at real junctions: OSM cuts a street every
  40 m or so, and a margin at both ends of every piece left room for one tree.
- **Yard trees**: up to four tries round each house (~1.3 trees a house), a
  third of them conifers -- Seattle's yards are full of firs and cedars; two
  round a campus building, one round a small low-rise.

The tests are the old scatter's (road, lot, water, drawn lake, pit, jump,
airfield, playground, building) plus pavements, but **most candidates ask one
2 m occupancy raster per chunk** (`occupancy`: footprints padded 1 m, every
carriageway with its pavement and verge, every junction's corner), built once
per chunk build: `roadLift` and `inBuilding` at ~6 and ~5 us a call were most
of the planting. It is conservative by half a cell's diagonal, so it only
ever keeps a tree further off. Street trees ask the exact queries.
`cityStats.treeRejects` counts why candidates fail -- the first question when
a kind of tree goes missing.

**A chunk with no road or building has no entry in the city** and was never
built at all: the middle of Seward Park, an island's woods. `buildChunkStep`
builds those too now (`NO_CITY_CHUNK`), trees only -- and **their far crowns
go to a shared pool, not a flat mesh of their own** (`TreeSystem.far`: one
`InstancedMesh` per species, each chunk a contiguous block written when it
arrives and zeroed when it goes), because a flat mesh per road-less chunk was
a draw each: 21 of them over Blake Island. 2 draws for all of them, never
culled, ~13k instances (~170k triangles) over Blake.

**The mid ring plants a fixed 60 %** of the near build's trees, skipped
before any test (`thin`): at 0.8-1.8 km the canopy reads the same, and the
ring's builds are what the streamer has to keep up with in flight.
Promotion to the near ring adds the rest where they were.

**Woodland past the trees is drawn by the terrain**: a 20 m coverage
texture of the wood mask (`geo.woodCover`, R8, linear, mipmapped, ~3 MB),
under which the ground is dark, mottled canopy -- the forest floor under the
near trees, and the forest itself where no tree is built. Two noise scales,
one turned 37 degrees: aligned, the periodic noise tiled into a waffle grid.
0 draws, 0 triangles.

`tools/greenshots.mjs <dir> [views] [--stats] [--fly]` shoots the brief's
views (capitol/magnolia/discovery/greenlake/arboretum/seward/alki-air,
residential and downtown streets found from the city, perfcpu's standing
spots) and with `--stats` prints the scene pass's draws and triangles and a
frustum breakdown by category; `GREEN_PROBE` / `GREEN_PROBE_SHOT` run a
one-off diagnostic on the same boot. The budget it was held to is in
performance.md, "The trees' budget".
