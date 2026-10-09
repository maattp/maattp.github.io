# Auto: Activities and Easter eggs

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

**An activity holds the world frozen with `game.hold('name')` and lets go with
`game.release('name')` -- never `game.paused = true`.** `paused` is the world's
"stand still" flag, but it is now two things: the pause MENU (`paused = v`,
what Resume, the pad's Start and `visibilitychange` flip, and what the
harnesses set to pose a shot) and the activities' holds (a `Set` of names). The
two were once one boolean, so coming back from the home screen inside the
arcade opened the menu over it and Resume cleared the activity's freeze: the
traffic and the police ran behind the screen. Now `setPaused(true)` refuses
while `game.held`, `visibilitychange` opens no menu over an activity, and Resume
cannot end a hold (only the activity's own `onEnd` / `_close` does). Seafair
holds `'seafair'` for its office and results panel, and releases it when the
race starts or it leaves. A new activity: `hold` in `tryInteract`, `release` in
its `onEnd`, and add it to `reapHolds` (main.js): a hold whose activity is no
longer `active` (its `start()` threw after the hold) is let go each frame, and
`doRespawn` clears them all -- Resume cannot, by design, so without that a
throw would freeze the world for good. Both record the name in `game.leaks`,
which the probes assert stays empty.

## Fishing off the piers (an Easter egg)

**A rod stands at the far end of four real piers and floats** -- Pier 66,
the Aquarium's Pier 59, Elliott Bay Marina, Leschi Marina (`FISHING_SITES` in
main.js, v126). Each is snapped at boot to the outermost walkable point of the
deck nearest it with open water past its edge (`fishingSpots`: a 2 m grid of
`platformAt` points, scored by `shoreDist`); a rod on a stand, a bucket and a
tackle box stand there (`fishingProp`), and the map marks it. ENTER on foot
goes to `game.tryInteract` before the cars.

- **The cast is in the city** (`Fishing.start`, `_castStep`, the game paused):
  the character turns to the water, a rod in the right hand bone, arm back
  and a snap forward, the line flying to a splash ring 14 m out, the camera
  beside and behind.
- **Then a Game Boy Color fishing game** (`src/fishing.js`), following Funky
  Fishing in Donkey Kong Country (GBC, 2000): 160 x 144 in a GBC shell with a
  D-pad and A / B, four-colour sprites drawn from strings, a 3x5 pixel font, a
  chiptune loop and blips on the game's AudioContext. v135 brought it to the
  real one's rules:
  - **You row a dinghy left and right** along the surface (DK rode Enguarde),
    the hook hanging under your rod; up and down drop and raise it (D-pad,
    arrows/WASD, or a drag on the screen). The line holds six.
  - **A reels in and the catch is thrown to a crab boat** drifting back and
    forth (Diddy's barge), quicker by level: it lands if the boat will be
    within 34 px of the throw, else it splashes back -- fish lost, and junk
    thrown there costs nothing. So you row under the boat before you reel.
  - Two or more of one kind on a line buy time (4 s per extra), three or more
    multiply the points. **KOMBO**: a line of one kind (two or more) lights
    the next letter, a mixed line resets it, all five refill 25 s and pay
    1000 x level.
  - Herring, perch, rockfish and salmon are the Bitesizes' colours (50 / 100 /
    150 / 300); a Giant Pacific Octopus is the Croctopus (20 points, +6 s);
    Dungeness crabs walk the bottom (250). **The dogfish are Chomps Jr.**: a
    small shark from level 2 that bites off whatever hangs on your line.
  - Cans and bottles from level 3, boots and tyres from level 5: -5 s each if
    they land in the boat. Nine levels by score. Time-up pays score / 20;
    best kept in localStorage `auto-fish-best`.
- While its screen is up the city is not drawn (the menu idle, see "Heat").

verify's "fishing" section: every site found its deck, ENTER casts and opens
it, the dinghy rows, a line banks with the boat in reach and not out of it,
combo time / junk / KOMBO / the shark / hooking / payout all to the number, and
closing it unpauses the city. `docs/fishing/` has shots.

## The flying fish at Pike Place (v129)

**A fish stall under the Main Arcade's canopy**, between the columns just up
Pike Place from the PUBLIC MARKET sign (`src/fishtoss.js`, laid out in the
market's own frame, `MARKET_FRAME` from landmarks.js: s up Pike Place, o off
its centreline). An ice bed sloping to the street with salmon, halibut and
Dungeness crab laid on it (the fish geometry the game throws), a wrapping
counter against the arcade, a FRESH FISH board, and three fishmongers in orange
rubber bibs (`makeHumanoid({ bib })`, new in peds.js: a loft hips-to-chest
over the shirt; only characters built with it change). One merged mesh plus
the board and the crew, shown within 260 m.

- **ENTER in front of the ice** takes the counter: a monger picks a fish,
  calls the order ("ONE KING SALMON, FLYING TO MINNESOTA!", the crew echoes
  the destination), winds up and throws. Slide along the counter (stick,
  A/D, arrows) and CATCH (button, Space, J) as it arrives: hands closed up to
  0.34 s before, or 80 ms after, catch it; a tenth of a second either side is
  PERFECT (x1.5); every five in a row adds to the multiplier (to x4). Three on
  the floor ends it, else a minute, faster as it goes, two in the air from
  the second half. Pays score / 40; best in localStorage `auto-fishtoss-best`.
- **Every throw is catchable**: it is aimed at RELEASE, within
  `CATCH_SPEED` (4 m/s) x flight x 0.62 of where you stand, and flown as real
  ballistics to that spot on the counter line. Aimed at the call (0.9 s
  earlier) some needed 4.5 m/s. A ring hangs where it will arrive (drawn over
  everything) and closes to the fish's size as it lands: the timing cue.
- The camera stands out in Pike Place 5 m up: at 3.5 m the crew stood between
  it and the catcher. The stall sits between two canopy columns (every 6.5 m
  from s -2), which otherwise stood in the middle of the view.

**The frontage it stands on was broken three ways, all fixed here:**

1. **Post Alley's cutting dug it.** OSM's Post Alley runs 26 m in a tunnel
   under the market, and its portal cutting dug the pavement under the canopy
   6 m down and the Pike St junction's carriageway 8 m down, and lidded Pike
   Place with a barrier: the stalls stood in a pit nobody could reach, and the
   junction had a hole in it. `G.NO_DIG` (capsules) lists ground no cutting may
   dig, and **a cut that would reach one is not made at all** (world.js
   `_computePortalCuts`, `cutStats.noDig`): lids and walls are decided from the
   corridor, so undigging the ground alone (the first attempt, via the cut's
   `protect`) left Pike Place lidded with no tarmac drawn. The 26 m bore stays
   a bore under the ground.
2. **The arcade was built at one height** (Pike Place at Pike St) while the
   street climbs ~5 m along it, so north of the stall the canopy, hall front and
   neon sank into the pavement. The body is built in spans along its outer
   edge and the street face bay by bay, each at `rel(s)`, the terrain at the
   kerb (landmarks build after the carve, so it is final).
3. **Its pavement was reported and never drawn**: roadLift said 52 cm the
   whole length, the chunk mesher laid nothing, walkers floated. fishtoss.js
   lays the floor from the kerb to the arcade face, level across at the
   pavement's height, and registers each 1.5 m slice as a city platform, so
   what you stand on is what is drawn (walked: within 2 cm).

verify's "flying fish" section walks the frontage at three places (no drop
over 0.3 m, the floor within 10 cm of the drawn surface, reaching the arcade),
plays a round standing under every fish (every one caught), one hands off
(over at three drops), the pay, and closing. `docs/fishtoss/` has shots.

## The Great Wheel turns, and you can ride it (v131)

**The wheel's rotating half is `src/wheelride.js`**; landmarks.js keeps the
hub, axle, A-frames and Pier 57's deck (`WHEEL` is exported from there). The
rim (two outer rings and an inner one, laced), the spokes from both hub
flanges and the pivot brackets are one merged mesh turning about the axle;
the 42 gondolas are two InstancedMeshes (frame, glass) whose matrices are
set every frame the wheel is within 1.4 km, each hanging level from its
pivot. It turns once every 90 s all day. Cost: 3 draws near the waterfront
(the rotating parts no longer merge into the landmark cluster), and on a
phone they are movers in the shadow pass (not the cache's statics).

- **ENTER on the boarding platform** eases the next gondola round to the
  bottom and stops it (`_nextToBottom`, `align`), you step in, and it takes
  you once round (~100 s with the start and the stop, 167 ft at the top) and
  lets you off on the platform facing the city. **Down** (or ENTER, Esc)
  brings it round at 6x.
- **The gondola you ride is a detailed one** (`riddenGondola`: frame,
  see-through glass, a floor, benches on its north and south walls) in place
  of its instance (scaled to zero). You sit on the south bench looking north:
  the open views from a wheel are out of its plane, along the axle; in the
  plane are the neighbouring gondolas, the spokes and the A-frames. Drag or
  the stick looks round; the readout is your height in feet. The gondola
  swings a little on its pivot as the wheel starts and stops.

verify's "Great Wheel" section checks it turns, rides once round (time,
height, stepping off) and the quick way down. `docs/wheel/` has shots.

**Dying, or Respawn from the menu, on the wheel or in the Needle's lift** calls
`wheelRide.abort()` / `needleTop.abort()` from `doRespawn` (they give back
the body, the fov, the UI and `body.wheelOn` / `needleOn`, and leave the player
where `doRespawn` put them). Without it `wheelRide.mode` stayed `'ride'` and
`_rideStep` dragged the respawned player back to the gondola every frame.
Probe: `node tools/bugrepro/wo6.mjs ride`.

## Golf at Interbay (v132)

**Three par-3s on the green west of 15th Ave W** (`src/golf.js`), where the
Interbay Golf Center's executive course is: 126, 140 and 155 yards, laid out
from the golf center's lat/lon on ground surveyed clear of roads, buildings
and water, falling 2-6 m across a hole. Each hole's tee, fairway (widening in
the middle), fringe, green (striped) and bunkers are cut out of a 1 m grid by
**marching squares over signed distance fields** -- the grass as the union of
tee, fairway and fringe, each bunker as sand drawn 1.5 cm over it -- so the
edges follow the shapes rather than stepping cell by cell (the first version
dropped whole cells and every edge was a staircase). One draped mesh on
`world.mats.flat`, plus a waving flag and a board per hole. The park's trees
and furniture keep off the holes (`city.jumpClearRects`); trunks beside them
knock the ball back.

- **A stroke**: aim (stick or drag; a ring shows the carry), the club picked
  by distance (CLUB or C changes it), SWING: the first tap stops POWER, the
  second the ACCURACY needle sweeping back through the white -- early hooks,
  late slices, both lose a little. Power goes to the launch speed as its
  square root, so the carry is about power x the club's full carry.
- **The flight** integrates quadratic drag against the air (`DRAG`, the
  clubs' launch speeds bisected so each carries its full distance in still
  air), a breeze of 0-6 m/s that grows with height, and sidespin curve.
  Landing bounces by the surface, takes most of an iron's pace, and backspin
  checks it for half a second (`CLUBS[].spin`): without that a 9-iron ran 20 m
  and a full shot went through the green. Rolling decelerates by the surface
  (green 0.62 m/s2) and runs down the slope at 0.4 of gravity's component (the
  course is shaped flatter than the 40 m terrain under it; at 0.7 a 3 m putt
  ran 5 m past). The cup takes a ball crossing it under 1.6 m/s; faster lips
  out. A road or a building is out of bounds: back where it was hit from, +1.
- The golfer is posed by the swing: side-on at address, bent over the ball,
  the grip on an arc round the shoulders with both hands solved to it
  (`solveArm`, exported from vehicles.js), the torso turning with it, the club
  from the grip to the head. The camera is down the line at address, chases
  the ball in flight (which is drawn never smaller than a few pixels), and
  sits low behind it on the green.
- The card after three holes; pays $150 for par, $50 a stroke either side,
  $500 more for a hole-in-one; best round in localStorage `auto-golf-best`.

verify's "golf" section plays a round with sweet-spot swings at the right
power in still air (tee shots on the green, the card, the pay), a ball into
15th Ave W (a stroke, and back to where it was hit), and closing.
`docs/golf/` has shots.

## The Belltown arcade (v133)

**A storefront on 2nd Ave** (`src/arcade.js`): at boot it finds the street
face of a real building nearest 2nd Ave at Bell St (a face at least 9 m long
that fronts a road 7 m out and is not itself on one) and hangs a glowing
panel on it -- brick, a window of lit cabinets, the door, ARCADE in neon. One
draw. ENTER at the door pauses the city and opens the room; the overlay is
opaque, so the city is not drawn behind it (the menu idle, as for fishing).

- **Six cabinets** (`src/arcadegames.js`), faithful to six classics' rules
  under generic names, original art, each at its own resolution: PADDLE
  (1972 tennis: angle by where it strikes, first to 11; the machine misjudges
  by more as a rally grows and tops out at 175 px/s, or two good paddles
  rally for ever), BRICKS (1976: 1/3/5/7-point rows, speed-ups at 4 and 12
  hits and the first orange and red, the paddle halving at the back wall,
  two walls), SERPENT, ROCKS (1979 vector: split 20/50/100, saucers, the
  quickening heartbeat, hyperspace, a ship at 10,000), SPACE RAID (1978: 5 x
  11, the march quickening as they thin, erodible pixel bunkers, the mystery
  ship), CROSSING (1981: five lanes -- one a Metro bus -- and the Ship Canal's
  logs and diving turtles to five homes against the clock).
- **The cabinet**: the canvas scaled pixel-sharp into a bezel with scanlines,
  a D-pad (8-way by the pointer's angle) and A / B on screen, arrows/WASD and
  Space-J / X-K on a keyboard; a fixed 60 Hz step. Each game is a pure
  `step(dt, input, sfx)` / `draw(g)`; `input.pressed` holds one-frame edges.
- **The panel stands 0.6 m off the wall, on the lowest ground across it**
  (`storefrontSpot`, v136). Mounted on the wall itself, a dense building's
  glass shopfront (15 cm proud) and its trim ledge (50 cm) covered its lower
  half, and it read as a sign hung a storey up.
- A credit is $1 (`charge`); beating a cabinet's stored high score pays $50
  (localStorage `auto-arcade-hi`). Sounds are square waves and filtered noise
  on the game's AudioContext (`Beeper`), one set per game, rate-limited.
- **The games are tested in Node** with bots and a stub canvas (they import
  only fishing.js's `FONT`): the brick bot clears both walls, a tracking
  paddle takes ~3 minutes to win 11, the others play to a game over.

verify's "arcade" section: the storefront on 2nd Ave, the room, a $1 credit,
20 s of mashed input on every cabinet without an exception, the high score
kept, leaving. `docs/arcade/` has shots.

## The pinball museum (v136)

**A storefront on Maynard Ave S** (the Seattle Pinball Museum's block in the
International District; `src/pinball.js`), found and hung like the arcade's
(`streetFace`, `storefrontSpot`, both exported from arcade.js). ENTER at the
door opens EMERALD CITY, an original table; the overlay is opaque, so the city
idles behind it. $1 a game, three balls; it pays $1 per 100,000 and $50 for a
new high score (localStorage `auto-pinball-hi`).

- **The physics is `src/pinballtable.js` and imports nothing**, so Node plays
  it. Table units are 20 to the inch (400 x 800, ball R 10.5), y down the
  glass, gravity 1150 u/s^2, 12 substeps a 60 Hz frame (under half a radius a
  substep at the 4000 u/s cap). Walls are thin segments tested by distance,
  bumpers and posts circles, each flipper a tapered capsule whose surface
  velocity (omega x r at the contact) goes into the bounce: aim comes from
  when and where on the flipper you hit, and a raised flipper cradles.
- **The head is flat with rounded corners, not an arch.** Round, a ball rode
  the wall from any medium plunge all the way to the left orbit and the top
  lanes were unreachable; flat, the ball leaves the right corner and falls in
  an arc, so plunge strength picks the lane (the skill shot: 0.25-0.40 of the
  pull drops into a lane, a full pull orbits to the spinner).
- **Every pocket was found by the bot, not by eye.** Inlane passages have to
  be wider than a ball under the slings (the first one wedged it), the inlane
  guides end above the flipper pivots (a V between guide and pivot held a ball
  for ever), and the orbit's exit deflector feeds the inlane (without it 46 of
  58 drains were the left outlane, straight under the orbit).
- Rules: S E A top lanes (lane change on the flippers, a set advances bonus
  X to 6), pop bumpers, slings, a spinner on the left orbit (60 spins relight
  the left outlane's KICKBACK), a P N W drop bank that lights LOCK at the
  saucer, two locks for three-ball multiball with a JACKPOT on the NEEDLE ramp,
  ramp combos inside 6 s, EXTRA BALL at the saucer after 6 ramps (then every
  10), 10 s ball save, TILT on the third quick nudge. The ramp is a scripted
  path in the air, taken only above 640 u/s at its lip; slower, it bounces off.
- The screen: a static playfield drawn once at the screen's scale, then the
  lamps, targets, flippers, balls and the ramp over it each frame; the view
  follows the lowest ball with a lead, or shows the whole table if the screen
  is tall. A dot-matrix display beside it (text rendered at 128 x 32 and read
  back as four-level dots). Left half flips left; the right half flips right,
  or, pressed while a ball waits in the shooter lane, is the plunger.
- `pinball.frozen` stops the frame loop stepping the table, for harnesses that
  step it themselves.

`node pinbot.mjs`-style testing: construct `Table({ rng })` in Node and flip at
any ball near a flipper; six games ran 35 minutes with no ball leaving the
table. verify's "pinball" section: the storefront, both panels standing on the
ground in front of the shopfront, ENTER, $1, touch on each half, the plunger,
a seeded bot game to the end with no escapes and every feature seen, the pay,
closing. `docs/pinball/` has shots.

## Hockey night at Climate Pledge Arena (v137)

**A marquee outside the south atrium on Thomas St** (`src/hockey.js`; the
arena's position is `lmRoot.userData.arena`, the door 95.5 m south of it where
the atrium's glass front peaks). ENTER anywhere round the arena -- within ~20 m
of its walls on any side (`near`), not at one secret spot -- drops straight into a game --
SEATTLE (you) against VANCOUVER, three 2:30 periods, one sudden-death
overtime, ties allowed -- with no team select or menu. A win pays $250, a tie
$100, a loss $25, plus $25 a goal. The overlay is opaque: the city idles.

- **The game is `src/hockeygame.js` and imports nothing**; with `humanTeam:
  null` both benches are the AI, which is how it is tuned. Feet and seconds,
  the rink 200 x 85 with 28 ft corners, nets 6 ft by 3.3 ft on the goal lines.
- **Mechanics, not scripts**, after the 16-bit classic: skating asks for an
  acceleration (momentum, carving, hockey stops); tap SHOOT for a wrist shot,
  hold for a slap shot, the stick's vertical picks the corner; SHOOT while a
  pass is on its way to you is a ONE-TIMER (control follows every pass); without
  the puck SHOOT is a lunge that flattens a carrier hit at speed, or a poke
  when slow, and PASS switches to the skater nearest the puck (or, when a
  teammate has it, calls for it). Draws are taken on the drop; early is a loss.
- **Goalies play the angle and react late**: they ride an arc in front of the
  net at a capped speed, read a shot after 0.1-0.2 s, reach further the longer
  they have seen it, and rebound hard shots or cover soft ones. So a pass across
  the crease and a one-timer beats them where a shot from the same spot does not.
- **Checked every substep of the puck**, the goalie and the net: at 100 ft/s a
  slap shot crosses the goalie's plane and the goal line in one frame.
- **The AI** plays roles: a shape by possession and puck (wingers wide, the
  centre in the slot, D at the points), the nearest defender pressures and
  checks, the rest mark; carriers dodge, pass to open teammates in the slot
  (who one-time it about half the time) and shoot from range bands only with
  an open lane (goalies excluded from that test, or it never shoots).
- **Balance, from Node** (AI-vs-AI and a scripted "human" through the same
  inputs a thumb gives): ~20 shots on goal a side, ~85-90 % saves, one-timers
  from the slot ~27 %. A bug worth remembering: the check used a signed speed
  that was only right when the hitter came first in the player list, and one
  team never flattened anyone -- measure a symmetric game for symmetry. The
  home side gets slightly better skaters and the CPU gives the skater you
  control a little more room than its own; without that the scripted player
  lost 10 of 10.
- The screen: a 400 x 225 canvas scaled pixel-sharp, the rink across it in a
  3/4 view (across the ice squashed 0.62) scrolling with the puck, pixel crowd
  (it jumps on a goal), ads on the dasher, every skater drawn from rectangles
  (stride, stick, number on the back, goalie's pads) with a marker under yours.
  Crowd noise swells near the nets; an organ, a goal horn, a whistle.
- `hockey.frozen` stops the frame loop stepping the game, for harnesses.

verify's "hockey" section: the marquee, ENTER into a game, a draw won on the
drop, the stick, a shot, a one-timer, a check, three seeded AI games to a final
with nothing leaving the rink, the pay, closing. `docs/hockey/` has shots.

## Boeing Field's control tower and FINAL APPROACH (v138)

**The tower is built in `landmarks.js` `airport()`** (it was a concrete box
under a glass box, floating: `box()` and `cyl()` there take the BOTTOM height,
not the centre). West of the GA apron at (across -300, along -190): a base
building with its door to the east, a tapered eight-sided shaft with a window
slot, a flared transition, a cab of glass leaning out between eight mullions,
a catwalk, the roof, two masts and a green beacon; shaft and base are solid.
Its door is published as `lmRoot.userData.tower` (with the shaft and cab).

**ENTER at the door plays FINAL APPROACH** (`src/atc.js`, `src/atcgame.js`),
after the touch-screen classic: aircraft arrive from the edges (an arrow
blinks where, first), fly straight and turn back at the edge, and you draw
each one's path with a finger. A path that enters the right landing zone
heading within 55 deg of its arrow locks (white dots) and lands the aircraft
on arrival: red jets on 14R from its west end, yellow props on 14L from its
east end, blue helicopters on the pad from anywhere, green seaplanes on the
Duwamish heading north (from the 12th landing); fast jets from the 8th.
Closer than twice their radii, two aircraft ring red and beep; closer than
0.82 of them they collide and the shift ends. Arrivals quicken with the count
(6.2 s apart down to 2.1). FF doubles the clock. A shift pays $3 an aircraft
and a new best $50 more (localStorage `auto-atc-best`).

- **The world takes the screen's aspect**: 1000 wide and 460-700 tall (the
  layout lives in y 20..460, the apron keeps to the bottom), so the edge the
  aircraft turn back at is the edge of the screen. Fitted letterboxing
  showed grass that looked playable and wasn't.
- The field is drawn once per size (mown grass, the river, taxiways, apron
  and hangars, runways with piano keys, arrows and numbers, the pad, trees);
  aircraft are canvas shapes with a shadow that closes in as they land.
- `tower.frozen` stops the frame loop stepping the game, for harnesses.

verify's "control tower" section: the tower standing off the pavement and
solid, ENTER, a path drawn with real pointer events from a jet into 14R's zone
locking and landing it, a prop's path into 14R not locking, a head-on warning
then collision, the pay, closing. `docs/tower/` has shots.

## The Duck Tour (v139)

**An amphibious DUKW you can drive anywhere** (`duck` in TYPES, `buildDuck`,
`updateDuck`, `DUCK` in vehicles.js), after the WWII trucks Seattle's lake
tours ran: a 9.5 m boat hull on six wheels in arches cut into its sides, an
open tub of benches and tourists under a striped canopy, a windscreen, and a
duck's face on the bow (eyes on the flanks, a bill on the stem). It is a truck
on land (`diesel`) and a boat in the water:

- **Afloat when the water under it is deeper than `floatIn`** (1.25 m), back
  on its wheels under `floatOut` (0.85 m) if the bed ahead is gentle -- at a
  steep bank it stays a boat and the bank is a wall. Afloat it IS the boat:
  `updateBoat` with a slow hull (18 km/h top; ~14 in practice) through a
  prototype of its spec, drawn `DUCK.draft` (1.28 m) under the waterline, with
  the cockpit rule keeping the tub's floor over the water.
- **Water is where the ground is under the local surface, mask or not.** Off
  the ramp the 10 m water mask said "dry" over 2.7 m of drawn lake and the duck
  drove the bed.
- **Its hull may run up a gentle shore** (`spec.minDepth`, -0.5 for the duck;
  a boat keeps 0.45): with the boat's probe a hull-length ahead, it stopped 9 m
  out in water too deep to put its wheels down.
- Everything that asked "is it a boat" asks `v.afloat` too: the wake and bow
  spray (main.js), getting out onto land (player.js), shore impacts, the
  engine's water sound (audio floating); player.js's drowning skips `amphib`.

**The tour** (`src/ducktour.js`): a kiosk at 516 Broad St by Seattle Center
(where the tours ran from), two ducks parked clear of the road beside it, and
a concrete launch ramp on Lake Union's west shore at Westlake (-181, -2612),
where the bank already runs gently into 3 m of water. ENTER at the kiosk puts
you at the wheel with a load of tourists; the captain's lines run as captions
while a beacon and a cyan dot on both maps show the next stop: Westlake &
Mercer, the ramp, SPLASHDOWN, the seaplane lane, the Eastlake houseboats, Gas
Works, back up the ramp, home. **In a duck the HORN is the quackers**: a chorus
of synthesised quacks, and people within 30 m tip $2 each, once (to $80). A
tour pays $150, $25 for the splashdown, and the tips; out of the duck for 20 s
or wrecked, it is off. The main.js wiring passes getters: the HUD, peds and fx
are made later in the boot than the tour.

verify's "duck tour" section: the lot clear of the road, ENTER starting the
tour, down the ramp (afloat, splash, the floor over the water, water speed),
back up it (wheels down, onto the street), the quack, the tour to the end.
`docs/ducks/` has shots.

## First Cup Coffee at Pike Place (v140)

**A storefront where the city's coffee story started** (1912 Pike Place,
under a generic name), on the east side of the street facing the market. It is
sited from the market's own frame (`MARKET_FRAME`, ~150 m up Pike Place from
Pike St) with `streetFace(city, at, r, want)` keeping only faces that look
across the street. **`streetFace` now also skips a face with another box
standing in front of it**: the first pick opened onto a building 4 m away
(OSM boxes overlap there). The arcade's and the museum's picks did not move.

**ENTER opens MORNING RUSH** (`src/barista.js`, `src/baristagame.js`), a
dash-style counter game. Customers come to the counter (four at a time, the
rest a line out the door) with an order bubble and a patience ring; you take a
cup (S M L), build the drink station by station and tap the customer to hand
it over. Shots follow the size (1-3, +SHOT one more) and take 1.4 s on one of
two group heads; milk steams for 1.2 s in a hot cup and pours cold over ice;
FOAM needs the milk steamed first. Exact pays the price and a tip that grows
with the patience left; one thing wrong pays the price; two or more and it is
refused and the customer waits on, crosser. 150 s, arrivals quickening from
~6 s to ~1.8 s apart. Keyboard: Z X C cups, A S D shot/drip/water, F G H
whole/oat/foam, J K L vanilla/caramel/mocha, ; whip, Q ice, Backspace bin,
1-4 serve. A shift pays the till and the tips (localStorage `auto-coffee-best`).

- Balanced with a bot that builds each order's plan (`Barista.plan`) at a
  fixed tap interval: at 0.35 s a tap it serves all ~43 customers, at 0.9 s it
  starts losing some, at 1.2 s a quarter walk out.

verify's "coffee" section: the storefront facing the street, ENTER, an exact
latte built with real pointer taps (tip), one mistake (price only), two
(refused), a bot shift to closing and the pay, leaving. `docs/coffee/` has shots.

## Seafair: unlimited hydroplanes on Lake Washington (v141)

**A drivable unlimited hydroplane** (`hydro` in TYPES, `buildHydro`,
`updateHydro`, `HYDRO` in vehicles.js): a turbine cab-forward three-pointer,
9.6 m by 4.4 m at the sponsons, with a canopy, a turbine cowl, a fin and wing,
and a propeller at the transom; engine profile `turbine` in audio.js. The
physics is the thing:

- **Thrust against quadratic drag** (top ~69 m/s, 153 mph; 0-100 mph 5.7 s);
  under ~25 m/s the hull drags until it gets up on its sponsons.
- **Turning is grip-limited**: the rudder asks for a yaw rate
  (`HYDRO.yawMax` at speed), and lateral demand past `HYDRO.grip` goes into
  slip. Full lock flat out HOOKS in ~2 s (a spin that scrubs off most of the
  speed); lift to ~50 m/s and a hard turn holds. `this.hooked` flags it.
- **Blowover**: the nose rises with the square of the speed (0.23 rad flat
  out); the stick trims it +-0.14 (back raises it); chop and other boats'
  wakes (`hyd.wakeKick`, set by the race) kick it. Past 0.27 the HUD flashes
  NOSE HIGH; past 0.36 it goes over backwards and is out (`this.blewOver`).

**The course** (`src/hydrorace.js` `Course`): an oval 3.77 km round in the open
water between Genesee Park and Mercer Island, run counter-clockwise: south
down the west straight past the pits (start/finish halfway down it), the
south turn, north up the back straight, the north turn. `at(s, off)` and
`project(x, z)` are the centreline arc length and the outward offset from the
inside lane. **Scenery is one merged vertex-colour mesh** (turn buoys, the
start pylons, the log boom and ~150 spectator boats tied to it along the back
straight, the pit dock and crane, team tents and grandstands on the lawn),
plus the start/finish banner. **The pits are found from the course**, walking
west from the start line to dry ground: the Stan Sayres lat/lon lands in the
lake, and the first build put the tents on the lake bed.

**Rooster tails are one `THREE.Points` system for every boat** (1600
particles, a small shader, fading within ~30 m of the camera so your own
tail does not white out the screen).

**A race** (ENTER at the pits opens the race office: the next Seafair Cup
event, free practice, the standings): six boats, yours `U-1 MISS SEATTLE`.
The rivals run in mode `race`, which traffic.js neither drives nor despawns.
The clock starts at 30 s ~1.35 km from the line; crossing before zero means
your start does not count (a lap lost). Cutting inside a turn's buoys is a
lap's penalty. Heats are 3 laps, the final 4; the AI keeps a lane, paces the
turns (~50 m/s) and the straights, gives room, lifts when its nose is high,
and paces its start to arrive just after zero by skill. Boat contact costs
speed on impact only (per frame, two boats steering into each other stalled
dead in the water). **The Seafair Cup** is heat 1, heat 2, final, points 400 /
300 / 225 / ...; purses $600 down to $50, the Cup $2,000 more (localStorage
`auto-seafair`). In the final a six-ship delta of jets (the `fighter` type,
driven kinematically) flies down the course. Measured with all-AI heats: laps
of 63-67 s, the field within seconds, nobody stalled.

verify's "seafair" section: the course all on deep water, the pits on land,
the boat's top speed / hook / held turn / blowover / nose control, a jump
start not counting, a buoy cut penalised, a whole heat to the flag with the
series advancing, back to the pits. `docs/seafair/` has shots.

**A race ended by WASTED or BUSTED** (`_raceStep` sees `game.dead`) is called
off (`_abandon`): the boats go, no results panel (it would hold the world over
the hospital respawn) and no teleport to the pits. The player's own boat is
taken off the lake once the respawn has got them out of it (`_orphan`). Leaving the boat alive for
8 s still ends in DID NOT FINISH and the pits, as designed.

## Basketball in the parks

**A half court in four parks** -- Cal Anderson, Judkins, Green Lake, Jefferson
(`HOOP_SITES` in src/hoops.js, v127). Each stands on the flattest open ground
within 150 m of the site (park or lot, off roads, buildings and water, under
0.6 m of fall across it; 8 headings tried). The search costs ~30 ms a site on
the Mac, so its answer is stored with the site (`at`) and boot only re-checks
it (0.1 ms for all four), searching again if the city under it changed.
**That fallback is silent and costs every launch**: Judkins' and Green Lake's
stored spots had stopped passing (the map and the grading moved under them),
and both searched on every boot, ~0.5 s at the 8x phone stand-in. When a
regrade moves a court, the console's `hoops: <site> at [x, z, heading]` line
is the new `at`; copy it in. A court is a slab at the
highest corner with concrete skirts down to the ground, registered as a city
platform (so you stand on what is drawn) and kept clear of trees
(`city.clearCircles`). Regulation size: 50 x 47 ft, the key 16 ft, the board
4 ft inside the baseline, the rim 10 ft up and 18 in across, the free throw
line 15 ft out, lines painted into one canvas texture. The courts show within
450 m; the map marks them.

- **ENTER on the free throw line** (after the fishing rods in
  `game.tryInteract`) pauses the city and starts ten free throws. Tap once to
  stop the AIM marker, once more to stop POWER; the shot is the launch speed
  that drops a 56 deg arc 2.5 cm past the rim's centre, off by the markers'
  error (linear plus a cubic, so the green zone keeps the ball in the few cm a
  24 cm ball has through a 46 cm rim, and a marker stopped at its end
  airballs).
- **Nothing is decided in advance**: the flight is integrated at 6 substeps a
  frame against the rim as a torus and the backboard as a plane, so swishes,
  rattle-ins, bank shots, rim-outs and airballs all come out of the
  collisions. Measured over a 9 x 9 grid of marker errors: the green zone
  swishes or drops, the outer third rims out, the ends airball.
- A make pays $10, a swish $15, doubled from the third in a row; the markers
  speed up on a streak. Best score in localStorage `auto-hoops-best`. The
  driving HUD hides and the camera narrows to 44 deg while it is up.

verify's "basketball" section: every park found a court, you stand on it,
ENTER starts it, green-zone shots go in and wild ones do not, ten shots end
and pay, closing gives the city back. `docs/hoops/` has shots.

## Up the Space Needle

**The Needle can be ridden, walked round and looked out from** (v128,
`src/needletop.js`). ENTER on foot within 7.5 m of the core (the map marks
it, and it says hello within 55 m) rides the glass elevator on the core face
between the first two leg pairs (`ELEVATOR_A` in needle.js) to the top in
15 s (41 s in life), eased at both ends, while the city runs on. The camera
stands at the car's open front looking out between the legs with a slow
glance each way, and the car's display counts the feet to 520. The view goes
dark through the SkyLine level's floor (100 ft), which the car passes
through. Skip, ENTER or Esc ends it early.

- **The deck is the landmark's own geometry made walkable**: `needleDecks()`
  (24 flat segments of the ring between the indoor glass, r 13.85, and the
  barriers' foot, r 16.25, at 158.47 m) go in as landmark decks, which now
  take a `rot`, and `needleSolids()` adds one box per barrier panel and per
  indoor glass bay, banded to the deck. Walked into both and round:
  r 14.2-16.0, never off the floor.
- **The car is live**: the model no longer bakes a cab on that elevator's
  rails, and `needletop.js` draws its own (1 draw; open front, rail, header,
  the display) where the last ride left it.
- **Six coin-op viewers** stand at the rail, with the elevator door in the
  indoor level's glass (one merged mesh, `world.mats.flat`, 1 draw). ENTER at
  one looks through it: two lens fields (an SVG mask, the union of two
  blurred ellipses), drag or the stick to pan (+-83 deg, slower zoomed in),
  + / - / the wheel / Q, Z to zoom 1.5x-16x. The eyepiece names a landmark
  within a sliver of the view's bearing and at an elevation between its foot
  and 120 m up it, else the neighbourhood the view's ray meets the ground in
  (`G.placeNameAt`), with the distance and compass bearing. The stands hide
  while you look (you are looking through one), and the FOV is restored on
  leaving.
- **On the deck the far layers come on but the near ring stays detailed**:
  main.js reports 50 m of altitude to the streamer there (over 45 turns on
  the far massing and roads; over 100 would drop the near ring to massing),
  and the on-foot boom is 2.6 m (`player.camShort`), the deck being 2.4 m
  wide.
- Neither new mesh casts a shadow: from 158 m it would land far out on the
  ground, and on a phone anything outside the shadow cache's statics is
  drawn into the shadow pass every frame.

verify's "Space Needle" section rides up, stands on the deck, walks into the
barriers, the glass and round, zooms a viewer and rides down to the plaza.
`docs/needle/` has shots.

## The Tech Tour

Twelve badges at the region's tech offices (`activities.js` `TECH`, v114):
Amazon (Day 1 / the Spheres), Google (South Lake Union, Kirkland), Meta,
Adobe and Tableau, Zillow, Expedia, Starbucks, Microsoft and Valve in
Bellevue, and T-Mobile in Factoria. A spinning cube in the company colour
under a light column, shown within 400 m; walk or drive through it for
$1000, all twelve for a $10,000 bonus. Found ones persist as `__tech` in the
activities save; the pause menu counts them and both maps mark the rest.

- **Positions come from OSM where the extract names the building** (marked
  in `TECH`), else the street address through `tools/proj.py`. Addresses
  alone were not good enough: Expedia's came out 700 m off in Elliott Bay.
  Microsoft's, Nintendo's and Meta's main campuses are in Redmond, east of
  the map, so Microsoft is at its Bellevue offices.
- **Snap to the nearest ground-level street node**, searching the nodes
  directly: `nearestNode` can answer a deck (Aurora over Fremont), and
  returns **-1, not null**, when nothing is in range (the landmark coins had
  the same latent bug).


## The wallet and the Seattle Passport (v194)

`Game.money` used to start at $250 on every launch, so every payout and every
DELIVERY button lived and died inside one sitting. `src/career.js` saves it
(`localStorage 'auto-career'` = `{ money, rank }`) and reads the rest of what
the game already keeps into one panel in the pause menu, between Resume and
JOBS.

- **Saving is a 1 Hz poll**, not a hook on the ~25 places that pay out: a write
  whenever `game.money` differs from what was last written (so the poll is also
  the debounce), plus a flush on `visibilitychange` (hidden) and `pagehide`,
  because iOS kills a backgrounded PWA without an unload. `Career`'s constructor
  runs right after `new Game()` and overwrites the $250.
- **The shop has no ownership**: a DELIVERY button spawns a vehicle or hands you
  the pistol, and nothing is kept, so nothing is saved. **The rank gates
  nothing** -- never add a gate; the player must not lose access to something
  they could afford yesterday.
- **The passport's rows come off the live lists**: `acts.found` / `acts.coins`,
  `acts.techFound` / `acts.tech`, the job medals over `acts.list`, `stunts.list`
  by `done`, `islands.found` against `EGGS` (exported from islands.js -- add a
  new `_reward` key there too; the check reads the source and fails if they
  differ), the mini-games' bests (`fishing`, `fishToss`, `hoops`, `pinball`,
  `tower`, `coffee`, `pickle`, `golf`: a best on the board = played) and the
  arcade's `hi` against `GAMES`. A row whose list is empty is simply omitted.
  The police mission best and the Seafair cups are shown as plain text; they
  have no total.
- **Rank = the mean of the rows' fractions** (each category counts the same, so
  the 20 coins do not drown the 5 island finds): Tourist 0, Local 10 %, Regular
  30 %, Insider 55 %, Local Legend 85 % (`RANKS`). A rank-up toasts once; a rank
  already earned when the session starts is stored and stays silent.
- **Verify**: `AUTO_HTTP_PORT=8000 node tools/careercheck.mjs [--desktop]` -- sets
  $5000, reloads, and checks the wallet came back; compares every passport
  number with a direct count off the sources and the menu's text; checks the
  rank, the toast, and that the panel sits in the card above the OpenStreetMap
  credit (the credit paragraph is the pause menu's end; do not remove it). Look
  at `tools/data/careershots/pause-top.png`.

## Taxi fares (`src/taxi.js`)

**FARE in a taxi (`spec.taxi`) goes on shift**, the way MISSION does in a police
car: the button sits in MISSION's slot (`data-taxi`, set by `TaxiFares.update`;
T on a keyboard), lights red while on shift, and pressing it again goes off.
`__dbg.taxi` (also `__dbg.jobs`).

- **The hail.** `peds.spawnFare` puts a civilian on the pavement of a surface
  street 90-240 m off (not a freeway, ramp, bore or `noTraffic` edge), facing the
  road with an arm up (`hailPose`, set after `animateWalk`). `p.fare` is the
  taxi's claim on a ped: 1 hailing, 2 walking to `(fx, fz)`; a claimed ped is
  never recycled by the 90 m cull and never scared (`scare`), so the taxi must
  always let go (`release`: `fare = 0` + `reanchor`, or `remove` when far).
  A thin yellow pillar floats over their head (above, not round them: a beam
  they stand in hides them) and a `!` pin is on both maps (`hud.fare`).
- **Searching is spread across frames** (`PathJob`, `searchStep`, `thinkStep`):
  FARE returns at once; each frame spawns ONE hail candidate and gives its A*
  220 expansions (a resumable, binary-heap A* with the strict one-way rules --
  `traffic.findPath` scans its open list and a *failing* search runs to its
  limit). The same for the destination ("Where to?" is a stage between boarding
  and the ride). Run to the end in one frame, a hail was up to 8 searches and a
  destination up to 13 more: at the phone's 8x, the worst single call of a whole
  fare went from 96-172 ms to 15-60 ms (`node tools/taxihitch.mjs`, 12 sites; the
  spread is contention on a shared machine). The union-find over the nodes and
  the search arrays are built by `warm()` at boot (~180 ms at 8x, on the loading
  screen): in the first frame of the first fare they were the biggest spike left.
- **Boarding**: stopped (< 1.6 m/s) within 14 m for 0.5 s and they walk to the
  nearer door (it follows a car that creeps), 7 s at most, then are removed from
  the crowd (in the back seat, unseen). Nobody pulls up for 150 s: they find
  another cab.
- **The destination** is a real name (`WANT`: landmarks by mapped name or
  neighbourhoods; ones the map lacks are skipped), 700-6000 m off, whose route
  `traffic.findPath` finds (>= 500 m), else a random corner named by
  `placeNameAt`. The drop-off is `respawnPointNear` (ground, not a deck); the
  route is drawn on both maps in yellow.
- **The money**: fare = $70 + $210/km of ROUTE (a detour earns nothing and costs
  time; `fareFor`). The tip is up to half the fare, x a speed score (1 at the
  par of 12 m/s + 20 s, 0 at the limit of 6.5 m/s + 60 s, which is also the fare
  clock) x smoothness (starts 1; `onCrash` impact >= 9 costs 0.3 and the streak,
  >= 4 costs 0.1, a pedestrian hit 0.4; a close pass over 14 m/s closing at under
  1.2 m gives 0.05 back, three at most). The passenger says so in a toast. A
  streak of fares without a crash adds $25 x (n-1), capped at 6 steps; the next
  fare hails 5 s after the drop-off unless you press FARE.
- **Drop-off**: within 15 m, stopped 0.4 s: they step out the kerb side and
  walk 14 m off (`leavers`, released into the crowd after 5 s), `audio.cash()`,
  the money (which `career.js` saves) and the count (`localStorage 'auto-taxi'`,
  read by the Passport's text line "Taxi fares n").
- **The objective line** is put back only if it is still the taxi's own text, and to the delivery that is current at that moment; another system's line (a police mission, a stunt) is never touched.
- **Ending leaves nothing**: leaving the taxi, WASTED, a respawn, 3+ stars, the
  fare clock, or FARE again all `end()`: pillar, map marks, objective line (put
  back only if it is still ours), the passenger and any leaver.
- **Verify**: `AUTO_HTTP_PORT=8000 node tools/taxicheck.mjs [--desktop] [--shots DIR]`
  runs the whole job at fixed dt with the game paused (the probe steps traffic,
  peds and the taxi itself) and every ending above; `--shots` writes `hail.png`
  and `dropoff.png` (camera forced behind the car with `updateCamera`, or it is
  still flying in from the last teleport).
