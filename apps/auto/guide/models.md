# Auto: Models

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Models

Cars and characters are the two things a player looks at closely, and both are
built rather than blocked out:

- **Vehicles** (`vehicles.js`) loft a shell through ~26 sampled cross-sections.
  The bottom edge of that profile **arches up over each wheel** (`archLift`) —
  without the cut, tyres just intersect a straight sill and the whole thing
  reads as a toy. Three geometries per type share materials across all
  instances: `paint` (tinted per car), `trim` (glass/chrome/lenses/rims,
  metallic; the glass is see-through) and `matte` (tyres/plastic/arches, the
  cabin and its occupants). See "Every vehicle type has an authored builder"
  and "Vehicle glass is see-through" below.
- **Characters** (`peds.js`) are `SkinnedMesh`es: one draw call each, but with a
  22-bone skeleton (`BONE_COUNT`), so elbows, knees and fingers actually bend.
  Geometry comes from a pool of 12 designed looks plus 4 cop looks and 3 SWAT
  (per-instance variety is skeleton, scale, colours and gait), with a sculpted
  head, textured from one atlas, and `animateWalk` is a procedural cycle —
  counter-rotating chest, level head, breathing idle, and the legs described
  below.

### The articulated bus (v134)

**King County Metro's 60 ft artic (a New Flyer XDE60 as RapidRide runs
them), in RapidRide red, as TWO vehicles.** `artic` is the 11.4 m front
section on the front and middle axles: traffic's lanes, AI, collisions and the
player drive it as a bus. `articRear` is the 6.5 m rear on the drive axle, a
`trailer`: `traffic.spawnAt` makes it with its front, the AI and despawn loop
skip it, and after every update (the player's artic too) `Vehicle.follow`
places it by trailer kinematics -- its drive axle dragged toward the
turntable, which puts it inside the front's path round a corner and straight
behind in reverse -- limited to 54 deg, sitting on the ground under its axle
and on the hitch. Then the bellows (`makeBellows`, a 16 x 7 corrugated ring
rebuilt from both sections' frames, within 150 m) stretch between them, open on
the outside of a turn and folded on the inside.

- The two sections never collide with each other; the rear is kinematic in
  `resolveCarCollisions` (other cars take the whole push); entering the rear
  enters the front (`nearestEnterable`); removing the front removes both.
- **Both sections are `buildBus`** with options (axles, doors, `frontEnd` /
  `rearEnd` -- a missing end is the bellows' dark mounting plate -- the roof
  pod, `noFrontAxle`). Its stations are now relative to nose and tail, which
  for 12 m are the old numbers: the city bus hashes identically.
- It takes one of the three taxi slots in `CIVILIAN_TYPES`, in place: the
  array is indexed by hash for kerbside parking, and appending would have
  changed which car stands in every kerb slot in the city. Never parked, off
  residential streets like the bus. The player's chase boom is 8 m longer and
  1.2 m higher in one, to clear the rear section.

verify's "articulated bus" section drives one straight, through a full-lock
bend and in reverse (rear on line, turntable within its limit, hitch joined),
enters the rear, and removes it. `docs/artic/` has shots.

### Every vehicle type has an authored builder

The generic loft (one `section` tube, triangle-fan end caps, boxes for lamps,
slab boxes for glass) used to build ten types. On a short car the flat caps are
most of what you see, so they read as bread loaves with lamp "ears", and the van
and bus wore their glazing as boxes standing off the sides. **`HAND_BUILT[spec.hand]`
is mandatory; `buildType` throws on a type without one.** A new type is a table
of stations over shared pieces, not 90 copied lines:

| helper | what it builds |
|---|---|
| `greenhouse(paint, trim, matte, g)` | the four-panel greenhouse (screens, roof, side glass, pillars from the panels' own edges). `pillarInto` / `roofInto` move pillars or roof to another builder (black pillars, glass roof on the EV); `rearY` above the deck adds a painted tailgate, because a hatch's rear glass run to the beltline is one black slab |
| `bodyCore(...).surf(z, s, i, d)` | a point on the DRAWN shell (end roll-in applied), `d` out along the section; `onShell` lays a lens or strip on it |
| `boxShell(into, cfg)` | a tall painted volume, flat sides, radiused roof edge — van and bus upper bodies, truck cabs, cargo boxes. Glazing goes ON it (`sideGlass`, `slopeGlass`) a few mm proud — lofting those bodies in glass turns the upper half into one dark slab |
| `truckCab`, `archCut`, `shellArch` | cab-over or bonneted cab with a squared front arch cut into the shell's bottom edge |
| `scaledBuild(build, refLen, refWid)` | runs an authored builder at its own size and scales vertices (normals by the inverse). Taxi and police are the sedan; wheels scale in position only, since `addWheel` builds them round afterwards |
| `aerofoil(b, col, stations, o)` | NACA 00xx skins through span stations for wings, tailplanes, fins (they were 18 cm boxes) |

Traps:

- **`endFace` must band at every outline station**, not only at hole edges. A
  face with no holes became three quads whose top one ran from full width down
  to the crown's zero: every cargo box front was a triangle standing over the cab.
- **A bright lens straight on the paint reads as a chrome shard.** `trim` is
  metalness 0.88, so a lamp patch on the wing mirrors the sky with nothing dark
  round it. Headlamps sit in a gloss-black housing (`headlampWrap`); red tail
  lamps on red paint have no sky to mirror and survive.
- **Valances tuck under the fascia.** A matte box 10 cm inside the end with
  22 cm depth pokes 1 cm past the face and reads as a black tray.
- **Liveries are spec, not spawner.** `spec.livery` overrides the colour in the
  `Vehicle` constructor; a taxi in a random colour is just a car with a sign.
- **Kerb side is -x**: `laneOffset` puts a vehicle heading +z at -x of the
  centreline, so bus doors are on -x.

### Vehicle glass is see-through, and still 3 draws a vehicle

- **Glass lives in `trim`, flagged per vertex.** `tagGlass()` gives every trim
  geometry a `glass` attribute (1 where the vertex colour is exactly `GLASS`)
  and reorders the index buffer so glass triangles come LAST. `glassShader`
  (trim's `onBeforeCompile`) turns those fragments into a dielectric pane:
  metalness 0, roughness 0.05, the reflected ray folded into the upper
  hemisphere like the curtain wall's, opacity
  `mix(GLASS_ALPHA 0.55, 1, (1 - N.V)^5)`.
- **The blend is premultiplied** (`CustomBlending`, ONE / ONE_MINUS_SRC_ALPHA):
  the reflection adds at full strength and only the tint scales the cabin.
  Straight alpha dims the reflection with the cabin and reads as grey film. Fog
  is corrected for it after `fog_fragment`.
- **The whole trim draw is in the transparent pass** (depth writes on). Opaque
  trim has alpha 1 and draws as before; the glass-last index order is what
  stops a pane depth-rejecting chrome behind it in the same draw.
- **`GLASS` is a MARKER colour now.** Anything dark that must stay opaque takes
  another one: door-mirror faces are `MIRROR`, because as glass they showed the
  empty pod behind.
- **A 4th glass material was measured and refused.** With 30 fixed civilians at
  perfguard's downtown camera: glass in trim 3.07 draws a vehicle, 437 a frame;
  a separate glass mesh 4.07 and 467 (+7 %), past perfguard's 4 % tolerance at
  ~14 cars, for no visual gain. Opaque Fresnel glass costs nothing and cannot
  show a cabin: it reads as a better-reflecting slab.

**What is behind the glass has to exist.** `carCabin(matte, g, paint)` builds
from the same greenhouse stations that drew the glass: floor, dash, seats (back
plus headrest on two posts — the gap is what reads as a seat), headliner,
wheel rim. **Drape the floor on the deck** (`deckAt()`): a flat floor at the
glass line showed body colour behind a hatch's rear seats. `boxCabin` (van,
truck, ambulance cabs) takes `sit`, the seated-shoulder level; `busCabin` has
no liner walls, because a bus is seen through.

- **Occupants are `matte.crew`, merged only into occupied geometry**: `matteGeo`
  (player), `matteGeoW` (traffic), `matteGeoWE` (parked, empty). `Vehicle.mode`
  is a setter that swaps the last two, so traffic.js and player.js make no
  calls. `scaledBuild` scales the crew too.
- **`boxShell` glass needs real openings.** Van, truck, ambulance and bus panes
  sit a few mm proud of the painted shell, and see-through they showed the
  livery. `boxShell({ windows, slope })` takes the `sideGlass` / `slopeGlass`
  arguments, adds their stations as ring stations and skips those quads
  (`Builder.loft`'s `skip(i, k)`). Flat end-face screens are `endFace` holes.
  Glass over solid lower body or a skin (bus doors, plane windows) is backed in
  dark matte instead.

Cost: +6.5 % triangles a traffic vehicle (weighted, 6,378 -> 6,791), bus +22 %,
box-shell trucks +13 %; perfguard's frame draws and triangles unchanged within
noise. Overdraw is the glazed area only.

### Characters: atlas, hair, looks

- **One 2048x1024 atlas** (`drawAtlas`, drawn at boot), one material, still one
  draw a character. The left square is the 4 x 4 grid of 256 px cells: cells
  5-15 are greyscale detail that MULTIPLIES the vertex colour (knit, jacket,
  denim, shoe, hair, hand, skin, hoodie, skirt, curly, uniform). Multiplied paint
  can only darken, so anything that must be the brightest thing on a garment
  (hi-vis bands) is geometry. The right square holds the five painted FACES,
  one per skin tone, at 512 x 341 (`faceRect`), on WHITE head vertices so the
  paint shows (skin encoded to match the neck, because vertex colours are
  linear and the map is sRGB). At 256 px a face was stretched ~3x at portrait
  distance and every feature came out a grey-brown haze. 10.7 MiB with mips.
- Parts map cylindrically round their own axis; `SkinAcc.add` repairs the back
  seam per triangle or every feature smears down the back. The face cell wraps
  +-100 deg of the head (`HEAD_SPAN`), chin to just over the hairline: ~500 px
  across the face. Shading the modelled head now does itself (jaw, chin,
  philtrum, nose sides) is NOT painted; lips, nostrils, a nose sheen and a lit
  chin are.
- **Features are paint, not geometry.** 3-6 mm eye/brow/mouth boxes read as
  stuck-on plates up close and, thinner than a depth texel, shimmered from
  across the street. Same for thin torso boxes (a placket): paint them.
- **Hair GROWS from the drawn head, not from the ellipse** (`buildHair`, over
  the head's own `grid`). Lofted shells with open bottom rings came out a bowl
  however the rings were treated. Hair columns ARE the head's columns: each
  shell point is `grid.at(j, y)` plus the head's NORMAL times thickness, at
  least **1.6 mm**. Offset along the ray at 1 mm it dipped under the head's
  triangulation (raycast: 0.2 mm out, then -0.6 mm) and the two fought. Each
  column starts at its own edge height (hairline, temple, sideburn, over the
  ear, nape); rows run edge, one between, then ON the head's own top rows,
  because a straight chord between rows anywhere else cuts inside the dome. Cap
  the crown, or the skull shows through as a pink smudge. The buzz cut is a
  3.5 mm shell: painted, its edge was one straight line with a pale band under
  it. Jitter the edge only at the sides and nape, clip strand strokes at the
  hairline, and paint the band above the hairline as skin, or a white line
  shows across every forehead.
- **Garments read at twenty pixels by their boundaries, not their grain.**
  Collars, hoods, cuffs, turn-ups, hems, belts are geometry; pockets, zips and
  ribbing are paint at 40-60 % value. Sleeves take the plain cell — a torso cell
  mapped round an arm puts pockets on the sleeves.
- **The pool is designed, not rolled** (`LOOKS`, via `buildCharacter({ variant })`).
  Twelve hashed looks came out with no buzz cut and no dress but five skirts and
  four side parts. Colours, skin, build and shoes still come from the seed.
  Shoes skew dark; off-white is one in six, because a white pair was the
  brightest thing on the pavement.
- **Cops have their own pool** (`copVariants`, `makeHumanoid({ cop: true })`):
  pooled characters ignore opts, so cops used to be civilians in random shirts.
  Tactical officers likewise (`swatVariants`, `{ swat: true }`: helmet, plate
  carrier, a carbine skinned to the hand; see "Wanted levels").
- **One material, several surfaces: the `gloss` attribute.** Roughness is
  `pedMat.roughness` (0.88, cloth) minus a per-vertex `gloss` (`GLOSS` by part
  name: skin 0.26, hair 0.22, shoes 0.22; vertices painted the skin colour get
  skin's; hair at 0.40 was one hotspot on the crown, varnished wood). At one 0.78 for everything, skin, hair, cotton and leather were one
  plastic. Applied in `pedMat.onBeforeCompile` on the EXPANDED
  `roughnessmap_fragment` chunk -- at that point the shader still holds the
  `#include`, so replacing the chunk's own text is a silent no-op. A geometry
  without the attribute reads 0: cloth, never a mirror.
- **Skin albedo is linear and was too light.** The two palest tones were
  0.95 and 0.99 red, whiter than a white shirt, and under the sun those faces
  and hands came out chalk (0.86-0.90 still did). Pale skin is pinker, not
  just lighter: `SKINS` now tops out at 0.84 / 0.64 / 0.53.
- **Folds are painted, soft, in pairs of shade** (`fold()` in drawAtlas):
  tension folds from the armpits, cloth gathering over the hem, creases behind
  and over the knee, the hem breaking on the shoe. A garment with none read as
  a coat of paint. Long sleeves have their own cell (`CELLS.sleeve`, index 16,
  in grid square 0, which the faces left empty when they moved right) with an
  elbow fan and a cuff bunch; short sleeves keep the plain cell, or the bare
  forearm below them would wear the creases.
- **Two body shapes** (`fem` in buildCharacter, cued like the face's `soft`
  by skirt, dress, long hair or bun): shoulders x0.90, joint x0.915
  (`geometry.userData.shoulderX`, which makeHumanoid builds the skeleton
  with -- the arms move in with the torso), waist x0.92, hips x1.05, arms
  x0.88, and 0.95 of the height. One torso under twelve outfits read as one
  mannequin in twelve costumes.
- **Hair is value structure, not grain**: clumps with a broken sheen, darker
  at the crown and underneath, broken by LOW-contrast strands (long strokes at
  30 % read as wood grain). Since the round after v175 the hair cell is mapped
  by the hair's own rows and ends in cut-out tips: see "Characters: hair in
  locks, and the head's second pass".
- **The long curtain TUCKS into the shell**: its top row 4-5 mm inside the
  shell, the next ~6 mm lower 3 mm outside, a steep dive. Started level with
  the shell (or under it, coming out at the shell's thin edge) the two crossed
  at a grazing angle -- raycast: 0.2 mm apart along the whole row -- and drew
  a torn, z-fighting ledge round the back of the head. No edge jitter on long
  hair for the same reason.
- **Feet stay 12-sided.** At 10 the ring has no vertex at +-z, the heel and toe
  move ~5 mm in, and that breaks `SOLE / HEEL_Z / TOE_Z` (see the gait).

### Characters: head, hands, hood

**The head is sculpted** (`headGrid`, `faceRelief`). `SKULL` is only the base:
the head is `HEAD_COLS` 32 x `HEAD_ROWS` 20, columns dense across the face
(0/3/7/12 deg at the nose and mouth), 10-26 deg apart round the jaw and cheek
(at 13-32 they showed as facets on every silhouette), and each vertex
is the base ellipse plus a relief (brow ridge, sockets, cheekbones, nose
bridge/tip/wings/columella, philtrum, lips, chin, jaw angle, muzzle).
`faceParams(seed, soft)` gives each pooled look its own features; `soft`
(skirt, dress, long, bun) softens jaw and brow.

**Judge the head in clay first** (`CHAR_EVAL` swapping the material for a
plain grey, on a buzz cut: `CHAR_OPTS='{"unique":true,"variant":2}'`, views
`face,face34,profilehead`). Painted, v118's head passed for a face; in clay it
was a flat oval, and that is what "his face looks really weird" was. v119:

- **The chin comes forward and narrows.** Off an adult profile the chin's
  front is 10-11 cm ahead of the ear and 4-5 cm wide; the rings had it 8 cm
  ahead and 8 cm wide -- a profile with no chin and a jowly jaw.
- **The face has a front plane**: a relief term turns the temples, the cheek
  behind the cheekbone and the masseter away round the sides. Sockets, brow,
  nose (tip 26.5 mm), cheekbones, lips and chin boss are about 40 % deeper.
- **The skull is a dome**: three rings over the hairline keep its breadth to
  within 3 cm of the crown. It was a cone from the hairline, and every buzz
  cut and hat was a pointed egg. The hair grows on every head row over the
  hairline (`tops` in buildHair), so adding a row there is safe.
- **The neck is 11-12 cm across and rises behind the jaw** (8.8 cm, straight
  up under the head, was a lollipop's stalk). `NP` in buildCharacter mirrors
  the neck rings for the hood and long hair; change both.
- **The hairline dips** 8 mm in the middle of the forehead and rises to the
  temples. It may not rise over `HAIRLINE`: the head is not drawn above it.

- **Relief moves a vertex ALONG THE RAY FROM THE UV AXIS `(0, HEAD_Z)`** at its
  column's angle. The face cell is a cylindrical projection round that axis, so
  UV depends on column and row only and sculpting cannot slide the painted eyes
  off the sockets. Put a new feature where `drawAtlas`'s `hp()` paints it: eyes
  +-21 deg; brows eye + 21 mm; nostrils eye - 47 mm; mouth chin + 45 mm.
- **The mouth needs a muzzle term, and the nose a columella.** Without the
  dental arch's forward push the lips sat in a dish; with the nose's whole
  underside running back to the lip in one row, its shadow smoothed onto the
  upper lip. Under a top light both read as a moustache on every face.
- **The lower face was still muddy, and neither cause was the sculpt.** Each
  was isolated by removing shadows, AO and map in turn (`CHAR_EVAL`):
  - **Self-shadow at building texel size.** The sun's texel is 0.25 m and its
    normal bias 0.12 m; a head is 0.23 m. `pedMat.onBeforeCompile` lifts the
    shadow lookup 0.60 m toward the sun, scaled by the length of the shadow
    matrix's depth row so it holds for any box. A body can no longer occlude
    itself; a building still shadows a pedestrian. **It is a string replace on
    r160's `shadowmap_vertex` and a silent no-op if that text changes.**
  - **Smoothed normals at the subnasale ring.** A white, unshadowed, unpainted
    head still showed the band. `creaseNoseBase` splits the normals per vertex
    across the nose and fades the split out by 16 deg; a per-quad weight or a
    per-quad face normal made blocks.
  - The painted face adds a soft sheen down the nose bridge and on the tip:
    seen straight on, the nose's front plane was the cheeks' value and the tip
    dissolved into them.
- The head is drawn only up to the hairline ring; every style and hat covers
  the rest. Ears (`buildEar`, a rim round a sunken bowl) are skipped under
  covering styles (long, curly, side), where they would poke through.

**Hands have fingers** (`buildHand`, `digit`, `FINGERS`). A flat palm facing the
thigh, four smooth-shaded fingers in a relaxed cascade (curl increasing toward
the little finger) and a thumb, ~196 triangles a hand. **Finger bones are
APPENDED** (fingL/tipL/fingR/tipR, indices 18-21), so every older index keeps
the meaning gait.mjs reads. The relaxed curl is in the bind pose and the bones
only add to it: a loose fist with `runBlend` in `animateWalk`, and
`gripHands(h)` (pronates and closes; `makeRider` calls it). Curl is
`rotation.z` with sign `-side`. Digit skin weights are looked up by exact vertex
position in a Map, which is exact because Builder copies corner arrays verbatim.

**Hood and long hair lie on the body.** The hood grows from the torso's own
rings (`tRings`) along their normals, full thickness down the spine and diving
INTO the torso at its edges, so there is no ledge; rim and lining ride the neck.
Three ovals behind the neck was a pillow. The long curtain starts UNDER the
shell and comes out from beneath its edge (started on top it made a shelf),
keeps 10 mm off the body (`bodyAt`), ends on the shoulders, and rides the chest
below the jaw — at 40 % head it went into a runner's upper back.

Finger and thumb ends are ROUNDED (one more ring at 68 % before the point;
four triangles straight to a point were a pyramid on every finger), +80
triangles a character. The thumb's base is buried in the heel of the hand:
at 9 mm off the palm's centre its base ring stood 2.5 mm out of the palm, open
end and all -- a floating prism with a dark hole.

**Contact shadows** (`makeBlobs`, `PedSystem.addContactShadow`): a soft blob
under each foot, shrinking and fading as it lifts (read off the foot bone's
world matrix from the last render -- free, and a planted foot has not moved),
and a fainter wide one under the body. One InstancedMesh for the whole crowd
and the player: one draw. A phone ped casts no shadow at all and a desktop
one's foot shadow is a 0.25 m texel smear, so every figure stood on the
pavement like a figurine on a board. The blob texture is OPAQUE grey: an
`alphaMap` reads green, and white over transparent was a hard black disc.
Paused harnesses must write them themselves (charshots, crowdshots and
walkcam do, guarded so they still run against an older build). Measured with
`perfcpu.mjs --runs=foot-dt --throttle=8`, two runs each interleaved with the
base: `peds` 1.47 / 1.37 ms a frame before, 1.25 / 1.44 after -- inside the
noise, so the blobs and the extra gait terms cost nothing that shows.

Cost: a pooled look is **3,869 triangles mean** (v119; 3,389 before the
denser head), head 1,094, hair 483, hands 392. Still one
draw a character and still pooled; 24 pedestrians with desktop shadows is ~20k
triangles more a crowded frame, ~1.7 % of perfguard's 1.18 M, and perfguard is
unchanged within noise. Building the 12 looks takes 41 ms in Node. Phones cast
no ped shadows, so there it is one pass. `tools/gait.mjs` output was
byte-identical across the head, hand and hood work.

### Characters: hair in locks, and the head's second pass

The round after v170 took the three lowest items of the character judge --
hair, the head and the hands -- and spent itself on the first two. Same
method: a fixed rubric (B1 silhouette, B2 head & face, B3 hair, B4 clothing,
B5 hands & shoes, B6 variety, B7 overall), an agent judge reading the
same sheets every round (six looks at face / face34 / profilehead / head,
on their POOLED seeds so colour and skin vary, plus the lineup, two crowd
frames and a walkcam crop). `docs/characters2/` has the before | after
images. Scores are at the end of this section.

**The atlas is alpha-tested.** `pedMat.alphaTest = 0.5`, the atlas uploads
`premultiplyAlpha` and `onBeforeCompile` divides the colour back out after
the test (`diffuseColor.rgb /= max(a, 0.5)`): straight alpha carried the
transparent texels' black into every cut-out edge, a dark rim on each lock.
Everything is opaque except the hair cells' tip bands and the locks cell,
because **drawAtlas fills the whole canvas first** -- an unpainted texel (an
empty grid square, a cell's padding) would otherwise be a hole wherever a
mip or a stray UV reached it. Cells are 256-aligned, so no mip level a
character is ever drawn at mixes two cells. One discard test, no draw, no
texture memory (still 2048 x 1024 RGBA, 10.7 MiB with mips); the shadow
pass's depth material copies `map` and `alphaTest` by itself. The divide
is a string replace on `#include <alphatest_fragment>` (a silent no-op if
that chunk is renamed on a three bump: every tip would go dark-rimmed). The
sRGB decode runs on the premultiplied value, so a half-covered texel decodes
a little dark; it only shows at the 0.5 threshold, as a slightly darker tip.

- **Hair is mapped by its own rows and columns, not by height.** buildHair
  builds with `Builder(true)` and records `hb.hairUV[vertex] = [t, s, cell?]`;
  the uvFn in buildCharacter reads it by vertex index (SkinAcc passes the
  index as a 4th argument, and takes a CELL PER VERTEX now -- it used to
  take the last vertex's cell for the whole part). t is the column's ANGLE,
  from the back round to the back (by index, the locks were crushed at the
  nose's 3 deg columns and stretched over the back's 26). s is the row: the
  edge is `TIP_S` (0.22), the crown 1.
- **Every edge is strand tips, not where a shell stops.** The shell hangs
  two rows below its edge (`NX`), 4-16 mm by `extTable` (least over a short
  style's ear and under a curtain, most at the nape), mapped to the tip band
  below `TIP_S`: transparent but for tapering locks that end in two or three
  wisps. The face cells shade the skin under every hairline (14 mm, the
  hair's shadow), so the tips blend into a darker scalp rather than being
  cut out of a clean forehead. **The forehead is only 19 mm from brow to
  hairline**: a 10 mm band there is a fringe, so the short styles keep 6 mm.
- **Crop, side, long, bob and curly have an OUTER LAYER** (`over` in
  buildHair): the shell's own rows from the tip band's middle row to the
  crown, 0.7 mm off at the edge and 3-8 mm higher up, swelling and dipping
  lock by lock, on `CELLS.locks` (grid square 1): 52 overlapping locks,
  closed into one surface near the crown, most ending in the tip band, each
  in four or five wisps that keep their width to their last ~24 px. The shell
  under it is the hair x 0.86 -- at 0.72 the band of shell between the locks'
  ends read as a second helmet under the first. The crown fan sits on the
  outer layer (the shell's would be in a hole in it). Curly's outer layer is
  the curly cell, lumpier (4-13 mm off) so its edge is two rows of coils.
- **One tapered shape per lock read as torn paper** (judge, three times):
  wide triangular tips with a crisp alpha edge are a sawtooth, and a lock
  that tapers over its WHOLE length parts from its neighbours halfway down,
  so the darker shell between ran down the hair as "drips of paint". Locks
  keep their width and end in short wisps; many fine tips read as strands.
  A dark stroke round each lock outlined it like a cartoon; darken only down
  its sides, faintly.
- **Paint for the cell's aspect.** The hair cells are ~2.2 mm a pixel round
  the head and 0.4-0.8 mm up it. Locks running up the cell tolerate it;
  round coils came out as horizontal smears ("wavy striations"), so curls
  are upright ellipses (x 0.36), and their tips are coils hung from the
  edge, not bars with round ends (battlements); coils centred deeper in the
  band floated on the forehead as blobs. The stubble cell's marks are
  upright too: square dots were horizontal dashes, and the skin between them
  drew a scratched white line along every buzz cut's hairline (raycast said
  "hair, tip band"; switching off the sun and the gloss did not remove it).
- **The long curtain is on the locks cell** (closed near the head, separate
  locks at the ends, the inner face showing through the gaps) with a ripple
  across it that grows as it falls; it gained a row at t 0.86 for the tips.
  A **bob** is the same curtain ending at the jaw with a third of the flare.
- **New cuts replace one of each duplicated pair** (`LOOKS`): a ponytail (a
  tapered smooth patch on a bezier from a tie at the back of the head to
  under the jaw, tips at its end; the hood is skipped under it), a bob, and
  a shaved head (scalp colour under `CELLS.stubble`, grid square 2: a
  stipple that thins out through the tip band, so its hairline is a fade).
  **The buzz cut is the stubble cell in the hair colour** -- as painted hair
  it was a skullcap with a fringe -- and both close cuts clip the sideburn
  to eye - 12 mm (a long point there read as Spock). **A cop's cap covers a
  buzz cut**, not the crop: the crop's locks stand up to 8 mm off the head,
  through the cap. `pickStyle` (unique builds: the player, riders) is
  unchanged.
- **The bun is a smooth patch** with its strands wound to the back:
  `Builder.spheroid` is per-facet, a cut gem stuck on the head.
- **Facial hair is vertex colour** (`LOOKS[i][3]`, 'stubble' or 'beard'): the
  face cells are per skin tone, and the head's rows are dense round the
  mouth and jaw, so a shade multiplied in under the cheek line, fading at the
  sideburn and under the chin and kept off the lips, follows the jaw. It is
  tinted TOWARD THE HAIR COLOUR (0.35 + 0.9 x hair), so dark hair darkens and
  fair hair warms; a plain dark multiply on fair skin was dirt. Full strength
  (0.8) still read as a dirty face; 0.58 beard, 0.34 stubble.
- **The short styles clear the ear by 6-8 mm more** (edgeTable over and
  behind the ear): the locks stand off the head, and the ear's rim came
  through them.

The head's second pass, judged in clay on the buzz cut first:

- **Eyes are judged at 2-9 m**, where an eye is a few pixels: what carries
  is the socket's dark and the lash line, not the iris. A cool orbital shade
  round the eye, a deeper lid crease, an under-eye shadow, an almond 29 x 11.5
  mm and a 2.9 mm lash line; brows twice as thick at the inner end and broken
  into hairs at their edges.
- **A side light drew a hard dark streak down every nose** and a sunken dent
  between cheek and mouth. The nose's plateau has a softer shoulder
  (`1 / (1 + nq^1.5 x 1.2)`, was `1 / (1 + nq^2)`), the hollow under the
  cheekbone is a third as deep with a fullness beside the nose over it, the
  muzzle is wider, the front plane turns away less, and the sockets and
  brow ridge are ~15 % deeper. The chin and jaw-angle rings are 3 mm wider:
  the narrowed chin had become a point.
- **The ears are their own part** (`'ear'`), skin-coloured on the plain skin
  cell: on the face cell they sat at its clamped edge and came out paler and
  pinker than the face.

What the judge still marks down (left for a next round): the hands (paddles
at 9 m), the shoes (one shape recoloured), the head shared by every look
(only `faceParams` varies it), the ears' shape, and skin showing through
skirts and dresses at the hip and the jagged neckline where the collar meets
the neck -- both of those were there before this round.

Cost: a pooled look is **4,396 triangles mean** against 3,959 before (+11 %): hair 493 -> 931 (the tip rows, the outer layer, the ponytail and the smooth bun), the head 1,094 -> 1,024 with the ears (70) now their own part. Still one draw a character and
still pooled; building the 12 looks in Node took ~110 ms, against ~85.
The atlas is the same 2048 x 1024 (10.7 MiB with mips): the locks and
the stubble went into grid squares 1 and 2, which were empty. One more
`discard` test in the character shader, and no new draw: perfcpu
`--runs=foot-dt --throttle=8`, four rounds interleaved with master served
side by side (24 pedestrians, 182 draws both): `peds` 0.40 / 0.38 / 0.52 /
0.54 ms a frame on master, 0.51 / 0.70 / 0.55 / 0.54 here; the last two
rounds, run with nothing else on the machine, are level, and nothing in
`peds.update` changed (the pose is the same skeleton; only the shared
geometry grew). Frame CPU 8.2-8.7 ms master, 8.4-9.7 ms branch, render and
traffic moving most between runs. gait.mjs prints the same table as before
(it reads bones, not the mesh); verify passes.

| judge, fixed rubric (1-10) | B1 | B2 face | B3 hair | B4 | B5 | B6 | B7 | mean |
|---|---|---|---|---|---|---|---|---|
| master, run 1 | 4 | 3 | 2.5 | 3.5 | 3 | 4.5 | 3 | 3.4 |
| master, run 2 (pooled seeds) | 4 | 3.5 | 3 | 4 | 3.5 | 4.5 | 3.5 | 3.7 |
| mid-round (A-D) | 4.5-5 | 3.5 | 3-3.5 | 3.5-4 | 3-4 | 5 | 3.5-4 | 3.7-4.0 |
| final | 4.5 | 3.5 | 3 | 4 | 3 | 4.5 | 3.5 | 3.7 |

**The absolute judge cannot see a change this size**: master scored 3.4
and 3.7 on two runs of the same images, and this round's builds 3.7-4.0.
A PAIRED judge (master and the round side by side, which is better on
each item and by how much) is the honest instrument for a round like
this one: it gave hair +1, variety +1 and overall +1, every other item
the same, and listed what still read wrong (the edge of the crop and
side fringes as torn paper -- fixed after it, see the locks' width --
floating coils on the curly forehead, a white line on the buzz, both fixed).
Use both next time, and the paired one to decide.

### The gait plants feet, it doesn't swing legs

`animateWalk` places each **foot** and solves the knee to reach it. A leg
alternates a stance half-cycle, where the foot holds a spot on the ground, and a
swing half-cycle, where it arcs forward. Rotating the hip on a sine cannot plant
a foot, and legs paddling under a gliding body is what reads as flailing.

**Everything here is judged by `tools/gait.mjs`, not by looking at it.** The rig
drives one character at a fixed 60 Hz across five speeds, with the root
TRANSLATING, and reports cadence, step, duty, double support, flight, hip
height, joint ranges, world-space skate of the heel/toe pivot, sole contact
(stance gap, mid-swing clearance, ankle on its limit) and a speed ramp
0 -> 1.4 -> 5 -> 7.2 -> 5 -> 1.4 -> 0 m/s through `player.updateFoot`'s damp
(worst planted-sole slip, worst ankle second difference — a pop is a change of
velocity, not a speed). `--trace` prints the frames around the worst pop.
**Every published band passed while the stride still looked wrong**, because
the rig did not yet watch the sole or a speed change: the foot landed toe-first
(stance pitch had the wrong sign — +x on the foot bone lowers the toe), planted
soles hovered or sank 3-9 cm, planted feet slid 26-33 % of body travel, and
every stop popped a sole 11.5 cm in one frame. If you change the gait, run it.

The laws:

- **The foot is rigid and rolls.** One flat-foot origin travels back at body
  speed while down; one sole pitch (toes up at heel strike, flat, heel up to
  ~50-60 deg at toe-off); the ankle is wherever a rigid foot pivoting on its
  heel or toe at that pitch puts it. **`SOLE / HEEL_Z / TOE_Z` in animateWalk,
  the shoe loft's bottom ring in buildCharacter and `soleOf` in gait.mjs are the
  same numbers — change one, change all three.** Ankle height, excursion and
  pitch as three separate dials is what made soles hover.
- **Planted feet are locked to the world.** `h.locks` remembers where a foot
  touched down; the leg is solved to that spot (sagittal and lateral) until it
  lifts, and the offset fades over the swing. Analytic stance targets only hold
  at constant speed and heading. **Callers must place the group BEFORE calling
  animateWalk** (`player.updateFoot` and `PedSystem.update` do), or the lock is
  a frame behind. `dt = 0` means "pose at this phase" and bypasses all history —
  the strip and portrait harnesses rely on it.
- **A lock never holds a foot across the body** (v159): at most 14 cm
  sideways and never over the midline (or inside where the foot stands
  anyway). The stick turns the player at up to 10 rad/s even at a standstill,
  so a light pull back swung the body round both planted feet and left the
  legs crossed or one flopped diagonally -- and **standing still, no foot ever
  lifted again**, so it stayed that way. Now, below 0.3 m/s, a foot more than
  3.5 cm off its spot steps back to it (lifted, ~0.3 s, one foot at a time).
  Measured over a light reverse, a full reverse, a 90 deg turn and a slow
  spin: the right foot ended over the midline, beside or past the left, in
  three of four before,
  never now. gait.mjs output is byte-identical.
- A lock is dragged, never re-planted: past 0.5 m from the analytic spot (warp,
  wall, hard stop), or further out than the stride ever puts a foot (`zLimit`),
  or the hips ride a foot left 86 cm behind and squat.
- **Each foot finishes its own half-cycle** (`h.gst`). Stance and swing are cut
  from one phase circle at `stanceSpan`, which moves with speed; a foot keeps
  its own progress, changes state only at the end, and catches up 0.04 of u a
  frame. **The cycle runs on a smoothed speed** (`h.gspd`, ~0.17 s), because
  the player's speed damps at rate 9 and re-shaped the stride every frame.
- **The stance window is balanced, not hand-set**: `back` is bisected so heel
  strike and toe-off limit the hips equally. A symmetric window lunged the
  front leg out straight.
- **Hip bob is explicit**: a walk takes a fixed 4.5 cm of the reach circle; a
  run sinks 3.5 cm under the scissored height plus a 5 cm flight arc; never
  above what the planted leg reaches.
- **Swing has zero vertical speed at both ends**: Hermite along z with backward
  end slopes (late-swing retraction), lift a smoothstep rise times a smoothstep
  fall. A sine over `u^p` has infinite slope at toe-off and lifted a sprinting
  ankle 21 cm in one frame. Toe clearance is a floor (~2 cm), not a by-product.
- **Double support exists.** `dutyFactor()` goes above 0.5 below about 2.5 m/s
  and the stances overlap; `h.contactL` / `h.contactR` are per-foot because the
  single `h.contact` cannot express it. Duty is 0.03 lower once running.
- **Gait keys off `runBlend`, not raw speed.** People change gait around
  2.5-3 m/s; clearance, lean, elbow carry and arm swing key off that blend.
- **Idle is blended in, not switched** (legs on idleW², after the upper body);
  switching at `A < 0.05` was the pop on every stop. A runner's arms drive back
  and come forward only to the ribs.

**Seen from the chase camera, every band passing still looked like a toy**
(the round after v168): a wide-legged walk with arms glued to the sides, a
plank of a torso, feet twisting on the pavement. None of it was in a band. The
laws from that round, each judged on `walkcam.mjs` chase/side sheets against a
fixed rubric and then held to `gait.mjs` (an agent judge, same rubric every
round, 1-10 against a modern open-world pedestrian: walking 4.0 -> 4.9, looks
3.1 -> 4.0; hair, the head and the hands are still the lowest items, at 3-4).
`docs/characters/` has the before | after lineup, walk strip, walkcam frames
and hair profile:

- **Feet land near the midline** (`footX` in animateWalk): 5.5 cm either side
  at a walk, 4.3 at a run, the hip width (8.5) only standing still. Planted
  under the sockets, 17 cm apart at every pace, it was a cowboy gait and from
  behind two parallel posts. The swing foot bows out 1.4 cm as it passes the
  planted ankle.
- **The leg solve is exact in 3-D.** The thigh's Euler order is XYZ, so its
  adduction acts on the BENT leg first: lateral = (thigh + shin's vertical
  share) x sin(z), so z = asin(dx / P). The old `atan2(dx, |dy, dz|)` was right
  only for a straight leg, and with the feet brought in its error moved with
  the knee and the planted foot crept sideways. Capped at +-0.3 rad: with the
  heel at the backside P is a few cm and the exact answer flares the knee.
- **The pelvis's yaw is taken back out at the ankle**, and the toes turn out
  (0.09 rad at a walk, 0.04 running). A planted foot riding the pelvis's yaw
  swung its toe, 16 cm out, sideways through every stance: that one term was
  most of the world skate at every speed (table: 2.9-6.0 % to 1.8-3.4 %).
- **The pelvis tilts forward with pace** (`tilt`, 0.02 standing to 0.16 at a
  sprint), and the trunk's own lean came DOWN to 0.14 at a run (was 0.24).
  On the spine and chest alone the lean was a hunch at the waist over a pelvis
  left behind -- "sitting back". The pitch is free for the legs (the sockets
  are level with the hips bone and the solve goes through its inverse), but
  **the foot's `level` must include `hips.rotation.x`**, or every sole tips by
  the tilt: the rig read a 1.0-1.5 cm stance gap at a run until it did.
- **A walk's twist and list are drawn larger than life.** The real ~4 deg of
  pelvic yaw and ~1.5 of list were in the numbers and invisible at twenty
  pixels. Walking adds 2.3 deg of yaw, 4 of chest counter-twist and 1.7 of
  list (`walkW`). The list lifts the stance socket, so the hips come down by
  `HIP_X sin(list)`, or REACH_PLANT's 3 mm margin is gone and the sole lifts.
  Sway is 2.5 cm (0.11 A) now the feet are under the body.
- **Arms**: a walker's swing is biased BACK (x1.15 back, x0.70 forward) with a
  0.32 rad elbow and the wrist a little flexed (straight, the curled fingers
  were a tray). Past 4 m/s `drive` grows the swing to 84 deg at a sprint (it
  was 55, the same as a jog, and from behind the arms hung by the sides) with
  less elbow fold per radian, or the leading elbow passes 100 deg again.
- **Swing lift is 0.072 at a walk** (was 0.085): the toe has its own clearance
  floor, and the extra height kicked the heel up to calf height -- a prance.

**Every band passed while the whole stance was spent in a crouch** (v118):
the planted knee never went under 25 deg and averaged 36 at a walk, against a
real 5 at heel strike and 10-20 through loading -- a Groucho walk, which is
what "he walks kind of weird" was. None of the rig's bands measured the stance
knee; the joint-angle curve over one cycle (thigh, knee, ankle, pelvis,
shoulder, elbow against normal-gait curves) showed it, and `gait.mjs` now
bands the mean stance knee (`stance-knee`; v118 fails it at every speed). Laws from it (v119):

- **`REACH_PLANT` may not be a few percent short of the leg.** On a nearly
  straight leg a sliver of length is a lot of knee: 97.3 % of the leg is 26
  deg of bend. It is `LEG * 0.998 - 0.003` at a walk; animateWalk takes
  another 11 mm off at a run (`RP`), where the pelvis rolls its sockets up.
- **In double support the LEADING foot holds the hips**, and the trailing
  foot rolls further onto its toes to keep reaching (`reachToe`, up to
  `TOE_MAX` 80 deg, faded out over early swing like a lock). Pinned to the
  trailing foot's scheduled roll, the hips sank through every weight
  acceptance and the new stance knee buckled to 38 deg.
- **A runner's hips are limited by what the toe can reach** (`reachOf`),
  and that reach grows from heel-off to toe-off (`toeCap`). Switched on at
  heel-off, a foot locked far behind let the hips jump 22 cm in one frame.
- **The hips may not RISE faster than 1.5 m/s.** Accelerating through the
  gait switch, the flight arc (computed from the analytic stride) snapped
  them 10 cm above where a locked toe-off had held them.
- **Step length is `0.40 + 0.245 v`** at a walk (0.74 m, 113 a minute), back
  to 0.45 across the switch: at 0.79 the lead foot landed 0.39 m out, a
  person's ~0.3.

Current figures, all inside their bands:

| | cadence | step | duty | bob | knee swing | hip height | stance knee (mean) | skate (world) | mid-swing clearance |
|---|---|---|---|---|---|---|---|---|---|
| walk 1.4 | 113 | 0.74 m | 0.61 | 4.0 cm | 69 deg | 97.3 % | 9 deg; was 30 | 2.4 %; was 2.9 | 6.0 cm |
| brisk 2.2 | 140 | 0.94 m | 0.52 | 4.8 cm | 71 deg | 96.4 % | 8; was 33 | 1.8 %; was 3.2 | 6.1 cm |
| jog 3.5 | 161 | 1.31 m | 0.40 | 7.8 cm | 101 deg | 91.9 % | 37; was 52 | 2.2 %; was 5.0 | 18.9 cm |
| run 5.5 | 183 | 1.80 m | 0.32 | 7.9 cm | 114 deg | 91.3 % | 41; was 56 | 3.4 %; was 6.0 | 23.5 cm |
| sprint 7.5 | 196 | 2.29 m | 0.26 | 9.6 cm | 123 deg | 91.8 % | 42; was 57 | 3.1 %; was 4.9 | 28.0 cm |

(Skate "was" is v168, before the round below; the other "was" columns are v118.)
Shoulder swing range (the rig's `arm`): walk 36 deg (was 28), brisk 45 (37),
run 67 (55), sprint 84 (55).

Ankle on its limit 8-32 % of a cycle. Speed ramp: worst ankle pop 9.8 cm/frame
(touchdown at a 7.2 m/s sprint); worst planted slip 8.1 cm/frame (was 4.2), a
toe dragged the frame it is held past toe-off while accelerating into a
sprint, when the body covers 12 cm a frame. It comes from the hips riding
higher, not from the toe roll (7.2 with reachToe off).

**The old note here said a run's 87 % hip height was "honest, not a crouch",
and it was a crouch**: the 87 % came from the 26 deg floor above plus a fixed
3.5 cm sink. The earlier warning still stands -- do not shorten the ankle
excursion by a fixed "roll" the sole never rolls through; reachToe pivots the
sole on its real toe, so the stance gap is still 0.1-0.2 cm.

On-foot pace is **5.0 m/s running and 7.2 sprinting**. It was 3.6/5.4, lowered
at some point to stop the gait reading as track athletics -- which was the wrong
lever, because the gait keys off `runBlend` and the rig judges it at 1.4/3.5/7.5
where it already passed. The pose was never the speed's problem, and a 26 km
city at 3.6 m/s is a chore.

Two standing traps. `animateWalk` owns `h.phase` -- advancing the cycle anywhere
else reintroduces the cadence/stride split. And the bones are **unscaled**, so a
step in world metres has to be divided by `h.scale` or taller pedestrians
over-stride.

The reference bands in `tools/gait.mjs` are published adult gait-analysis
values -- cadence and step-length curves, duty factor against speed, joint-angle
ranges -- so the rig judges against an outside standard rather than against a
screenshot.

### The Space Needle

The Needle is `src/needle.js`, built to published dimensions. The reference
table at the top of that file gives each number and its source: 605 ft to the
beacon, the 500/510/520 ft top-house levels, SkyLine at 100 ft, a 102 ft base
circle, the 373 ft waist, the 42 m halo, 48 barriers leaning out 14 degrees,
and Astronaut White, roof included, since May 2023. The profile the sources
leave out was measured off Commons photographs. The legs are three pairs of
columns swept through a monotone-cubic radius profile. They are welded into
one blade from 79 to 128 m and fork into Y arms above that. **Leg thickness is
tuned to the distant read, not only to the drawings.** With legs of about
1 m, which is what the drawings imply, the dark core was the only thing
visible from 500 m and the tower read as a black pole. Legs sized to look
4-5 m wide from Kerry Park, as they do in photographs taken there, restore the
white hourglass. The Needle has its own materials (`NEEDLE_MATS`), so
`mergeByMaterial` returns meshes that belong to the Needle alone.
`buildLandmarks` names them `spaceNeedle`, culls them on their own bounds and
lets them cast and receive shadows. That is 6 draws and about 14k triangles.
The two glass materials fold the reflection into the sky hemisphere, the same
way the curtain wall in world.js does. `node tools/needleshots.mjs <dir>`
frames nine views from the landmark's own position: plaza, base, under,
street at 590 m, tophouse, Kerry Park at the game's FOV and at telephoto,
aerial, and 4 km toward Beacon Hill. It also prints the Needle's draw and
triangle cost.
