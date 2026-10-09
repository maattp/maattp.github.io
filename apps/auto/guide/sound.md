# Auto: Sound

Part of the Auto guide; the index and the laws every change needs are in
`apps/auto/CLAUDE.md`. Sections moved here verbatim from that file.

## Sound

**Everything is synthesised; the repo ships no audio files.** `audio.js` has
three layers, each built for what it costs on the phone:

- **One-shots are rendered once.** `SOUNDS` holds recipes (crunch, slam,
  debris, glass, scrape loop, explosion, pistol, punch, footsteps on
  hard/grass/gravel/water/wood, doors, seat, starter, kickstand, air brake,
  backfire, blow-off valve, gear knock, expansion joint, splash, slosh loop,
  squeal loop, gravel and grass loops, the ambience beds and birds, crows,
  gulls, distant horns, pickup, cash, wanted sting, UI cues). `renderBank`
  builds them in ~3 s batches of OfflineAudioContexts, seeded so every launch
  gets the same bank (97 buffers, ~95 s mono, 15.2 MB at 48 kHz; ~1 s wall
  and ~0.35 s of main-thread graph building, spread over 47 batches),
  filling the bank IN PLACE in `BANK_FIRST` order: footsteps, doors and
  impacts are ready after the first small batch. Playing one is a
  BufferSource + gain (+ panner, + distance low-pass, + reverb send), capped
  at `MAX_SHOTS` 18. `bankStats` (exported) records the build time.
- **A one-shot is trimmed to its sound** (`trimTail`: 10 ms past the last
  sample within 60 dB of the peak), and recipes marked `half` -- nothing above
  ~10 kHz worth keeping: the ambience beds, birds, crows, gulls, distant
  horns, the slam, the joints, the grass loop -- render at half the rate, in
  their own batches, last. Recipes have round durations and the silence after
  the sound was a third of the bank: untrimmed, the new sounds took the bank
  from 12.2 to 21.3 MB; trimmed and halved it is 15.2.

**The context is created at boot and unlocked on the first ACCEPTED gesture.**
It used to be created, and resumed, on the first `pointerdown`, and the
listener then removed itself. A touch's pointerdown is not user activation
(only pointerup / touchend / click are, plus keydown and a mouse's
pointerdown), so on the iPhone walking with the stick created a context that
could never start: silence until some unrelated tap -- unpausing, the radio
button -- resumed it, and then every sound at once. Now `audio.init()` runs
before the reveal (a suspended context needs no gesture, and the bank renders
while you load), and wireUi listens on pointerup, touchend, click, keydown and
pointerdown in the CAPTURE phase (the on-screen buttons stop propagation),
removing itself only once `ctx.state === 'running'`. `audio.live` gates
`play()` and `update()`: anything scheduled on a suspended context piles up at
time 0 and fires all at once on the unlock. `tools/audiounlock.mjs` drives the
stick with real CDP touch events under the activation policy and prints the
state at each step (`--bench` times the bank; use `AUTO_GPU=1` -- on
SwiftShader each render batch waits for a ~0.5 s frame and the bank reads
20-40 s, which measures the harness).

**The radio is twelve stations** (v122, `STATIONS` in audio.js): KEXP, RdMix
Classic Rock, BBC Radio 1, Top 100 Charts, NRJ Linkin Park, Rock Antenne
Alternative, 80s Drive, C89.5, KNKX, Classical KING FM, and two synth-only
stations. Every live one keeps a synth voice for when it is offline or dead.
Getting into a car tunes a random one (never the last); RADIO on the driving
pad (the only on-screen radio control, and only in a car: v124 removed the
HUD's 📻), R or the pad's shoulder buttons tune the next;
the pause menu lists them all.

- **Find streams with the radio-browser.info search /apps/radio uses**, then
  check each with curl: HTTPS, an audio content type, and a CORS header for
  polkiewicz.com. An https page may not load an http stream. BBC Radio 1's HLS
  master playlist points at an http variant, so the station is that variant
  over https; Safari plays HLS in an `<audio>`, and a browser whose
  `canPlayType` says no skips the station (`playable`).
- **The element has no `crossOrigin`**: nothing reads its samples, and asking
  for CORS only lets a station fail.
- **A stream that neither plays nor errors is silence forever**, so 20 s in
  `loading` marks it failed and the synth voice covers. BBC Radio 1 takes
  ~13 s to start in desktop Chrome. A failure is forgotten on retuning.
- Only KEXP has a now-playing feed; the others put titles in the stream
  (ICY), which a media element hides.
- verify tunes every live station in a car and reports how long each takes to
  sound (reported, not failed: they are other people's servers), and fails if
  five cars in a row get the same station. **That check used to get in the nearest
  enterable vehicle within 600 m of wherever the sections before left you --
  the Aurora Bridge's deck among moving traffic, or Winslow's dock -- and
  sometimes there was none, or one you did not stay in: one station "seen",
  every stream "no sound", and the offline half "SILENT -- BUG" (v168 failed
  it in most runs). Since v169 it respawns you on the street node nearest
  Westlake and spawns its own sedan beside you.

**Resume from anything but `running`, on every gesture, for the whole
session (v120).** iOS stops the context behind the page's back (the home
screen, a call, Siri) and reports it as `interrupted`, which Chrome never
does; `resume()` only acted on `suspended`, so on the iPhone the game went
silent and stayed silent. The unlock listeners never remove themselves (a
running context makes each one a state check), and `audio.init()` sets
`navigator.audioSession.type = 'playback'` so the ring/silent switch does not
mute the game (iOS 17+; the radio's media element never followed it, which is
why the radio could play while nothing else did). `tools/audiounlock.mjs`
fakes an `interrupted` context and taps again; master before this fails it.

**`primeLive` retries after `NotAllowedError`, and never touches an element
the real stream holds.** Letting it retry exposed a race verify's radio check
caught (3.8 s streamed -> 0.1 s): a late prime re-muted and paused a stream
already loading. It now returns if the stream is loading or playing, and a
token lets `startLive` supersede a priming play still in flight.

**Starting reliably on the iPhone** (v165). Sound sometimes started only
after a later tap, or not at all, and none of it reproduces in Chrome
(`tools/audiounlock.mjs` unlocks on the first touch's lift there every time),
so what is in place is every known WebKit cause closed off, and a log:

- **The radio's unlock plays a silent clip, not a station.** `primeLive`
  pointed the media element at a live stream on the first tap: every launch
  opened a radio stream on foot, its `play()` settled only once the stream
  had buffered (13 s and more for some stations, never for a dead one), and on
  iOS a media element starting up shares the audio session with Web Audio.
  `SILENT_WAV` (0.1 s, in memory) unlocks the element the same, at once.
- **The context is resumed last in the gesture**, after the radio's element
  (`startAudio` in main.js), and a one-sample silent buffer is started in
  the gesture (`kick`): some iOS versions keep a resumed context's output
  muted until a source starts inside a gesture.
- **A context that stops while the page is visible asks to start again**
  (`onstatechange` -> `_heal`, at 0.3, 1, 2.5, 5 and 10 s): iOS lets an
  interrupted context resume without a gesture once the interruption ends.
  The gesture listeners stay as the fallback.
- **The Debug readout shows the audio's story** (`audio.log`, `_log`): its
  state, each change, what resumed it or refused to, the radio's unlock. If
  it happens again, a screenshot of that panel says why.
- `_log`, not `note`: the synth radio already has a `note()` (it plays one);
  a second method of that name replaced it and threw in `init()`, which left
  the whole bank unrendered -- audiounlock.mjs caught it.

**Footsteps are a heel knock and a sole roll under ~1.5 kHz, at a quarter of
their old level.** They were a white-noise click at 2.2-3.6 kHz with an
instant attack (centroid 3-6 kHz), and the footsteps scene measured -28.6 dB
RMS against -33.4 for a car passing; now centroid 0.65-1.6 kHz and -35 dB,
with +/-15 % per-step gain and pitch variation.
- **Engines are a firing pattern, not an oscillator pitch.** The tone's
  PeriodicWave is the spectrum of one exhaust pulse per cylinder at its point
  in the cycle (`ENGINES[..].fire`), so the cross-plane V8's uneven banks and a
  V-twin's 315/405 split give their burble by construction. `EngineModel` is the
  machine (gears, clutch hold off the line, shift points by throttle, rev
  limiter, spool-up, lift-off crackle, turbo boost, rev-matching blips) and
  `EngineVoice` the 19-node graph it steers. **The profile is picked from spec
  flags by `selectEngine`** -- the comment above `ENGINES` lists them: `engine`
  (explicit), `heli`, `boat`, `plane` (+ `turboprop`/`jet`), `ev`, `moto` (+
  `vtwin`), `atv`, `bus`/`cargo`/`diesel`, `police`/`v8`, then `hand` (muscle,
  convertible and pickup a V8, sports the twin-turbo flat-six, hatch the turbo
  four `i4t`, compact the three-cylinder `i3`, suv and van a V6, the rest an
  `i4`). A new vehicle type needs only a flag.
- **Positional voices are pooled**: 3 traffic engines (nearest cars in 70 m,
  kept on the car they have), 2 sirens (LFO on the carrier, so the sweep is
  smooth at any frame rate; wail far, yelp inside 45 m; a police car you
  drive with SIREN on takes one too, always wailing, a little quieter: you
  hear it from inside), the police helicopter
  (built on first sight). Pan, distance and doppler come from `spatial()`
  against the camera (`listener` in main.js).
- **Mix**: every bus into one DynamicsCompressor limiter, then the volume
  control. `duck()` pulls the synth radio down under crashes, gunshots and
  stings (the live stream too, except on iOS, which ignores `volume`). A
  convolver with a generated street IR takes sends from one-shots and, in a
  bore (`enclosed`), from the engine.

### Gearbox, turbo, tyres, impacts, ambience

**The gearbox is heard, one change at a time.**
- **Downshifts are 0.3 s apart** (`EngineModel.downT`). Braking from speed
  dropped a gear a frame: one smeared rise, never a downshift.
- **A sporty box changes down early under braking and blips** (`blip`: the
  V8, the flat-six, the turbo four, the bikes): with the car decelerating
  over 3 m/s^2 off the throttle it changes down at half the redline instead
  of 30 %, and each change is 0.17 s of 0.9 throttle with the revs
  overshooting the new gear's by 16 % -- heel-and-toe, and the crackle
  profiles pop after it. `decel` is the model's own smoothed d(speed)/dt, so
  traffic gets it too.
- **Never up while braking.** The blip took the revs past the lift-off
  upshift point (52 % of the redline) and the box hunted up and down every
  frame. Caught by stepping `EngineModel` in Node -- it is pure JS, and
  `import('./apps/auto/src/audio.js')` works there: print gear, rpm, load,
  boost and events per step before rendering anything.
- `clunk`: the bikes' shift drums and the heavy diesels' boxes knock on a
  change (`shift`); the cars, automatics, do not.

**Turbo** (`turbo` on `i4t` and `flat6`): boost is throttle x revs past 30 %
of the redline, spooling at `lag` (1.7-2.3 /s) and dumped at 10 /s on a lift.
The whistle is the voice's whine oscillator, its pitch and level riding the
boost (level ~ boost^2), not the revs; the intake roar grows by `hiss` x
boost; and a lift or an upshift that vents more than 0.35 of boost fires the
blow-off valve (`bov`: a falling hiss, or a compressor-surge flutter), so
flat out through the gears is spool, "pssh", spool. The diesel's turbo stays
the old load-driven whine: diesels have no blow-off valve.

**Tyres: one squeal voice, three causes.** The slide (vehicles.js `skid`,
lateral slip), a lock-up under hard braking (brake over 55 % above 4 m/s:
pitched x0.74, a howl under the slide's scream) and wheelspin off the line in
anything with `acc` >= 5.5 (gone by 11 m/s). The strongest wins and sets the
pitch; heavy vehicles x0.8. vehicles.js has no longitudinal slip, so these
two read the inputs, which is what the player is doing anyway.

**The road under the tyres.**
- The tread's hiss: a band off the shared bed noise at 750 + 22 x speed Hz
  (550 for heavies), level ~ (v / 32)^1.5 over the rumble -- what 100 km/h
  sounds like, and why a stop is quiet. A `Gate`: disconnected when still.
- Grass has its own loop (`grass_roll`: swish, stalks, the thump of uneven
  ground); gravel keeps the crunch.
- **`surfaceAt` knows decks and piers.** Over 1.5 m above the terrain over
  the water within 6 m of it is `wood` (a pier, a dock, a low floating
  bridge); otherwise it is `deck` (a bridge, a viaduct, a roof) **unless the
  carriageway there is not a bridge** (`carriagewayAt` -> `!e.elev`): graded
  freeway on fill stands metres over the terrain too, and asked by height
  alone 35 % of ground-level I-5 clattered like a viaduct. On a deck or
  `wood` a car's tyres hit an expansion joint every ~32 m (`joint`, front
  axle then rear, wheelbase / speed apart, the deck's hollow boom under the
  clack), and on foot `wood` is a hollow board knock (`step_wood`).
- **Wheels on the ground is read from the spec, not only the profile.** An
  engineless vehicle (kayak, bicycle, balloon) keeps the last car's engine
  profile, and a kayak over the water reads `wood`: by `p.kind` alone it got
  tread hiss and expansion joints under its paddle. `onGround` also excludes
  `spec.boat`/`balloon`/`heli` and `s.onWater`.

**Impacts by severity, and by size.** Under 3.5 a tap, under 7 a knock, from
7 a crunch, over 15 glass (75 %; 20 % on a bike) and debris -- trim and
plastic bouncing for a second -- and over 26 the `slam`: a deep body thud
with the structure's low modes ringing, a second crunch, and the radio ducked
for 0.9 s. Pitch goes as mass^-0.13 (a bus x0.82, a sportbike x1.22), so
the same hit is heavier in a heavier vehicle. **The scrape is a grind, not a
whistle**: it was four narrow resonances with sines at 1.65 and 2.2 kHz on
top, a steady band that read as a kettle; now stick-slip chatter round
420 Hz through a shaper carries it, the hiss rides on that, and the sines
are a third of what they were.

**The ambience** (`_ambience`): what is around you, as you hear it standing
there. main.js samples two rings round the camera (45 m and 140 m, 12 points
each, mask lookups: `G.isWater`, `G.inPark`, `onRoad`) twice a second into
`s.amb` -- shares of water, park and road, and the height over the ground or
the water -- and traffic within 160 m is counted in `_updateWorld`. From
those, smoothed over ~1 s:

- **Two beds** (Taps on the bank, disconnected when silent): `amb_city`, the
  traffic of a few blocks blurred -- rumble, unseen cars passing as swells of
  tyre wash, a building's air handling -- by "urban" (road share x 1.8 +
  cars / 24); and `amb_water`, waves washing, slapping and fizzing back, by
  the water share. In a car x0.45 / x0.5, in a bore the city x0.3 and no
  water; height fades both.
- **The wind** is the bed's wind band, shared with the rush of speed (the
  larger wins, as a root-sum-square): gusts and lulls alternating 0.7-3 s,
  stronger up high (the Space Needle's deck, a rooftop, a balloon) and over
  open water, narrowing to Q 1.3 and riding its pitch on the gust when it,
  not speed, is the wind you hear.
- **What comes and goes** is a positional one-shot through `play()`,
  Poisson-timed by the context (`_due`: a unit exponential spent at the
  current rate, so the rate can change under it): birds (six species'
  phrases) by the park share, a crow now and then anywhere green or urban,
  gulls by the water share, and a car horn 60-200 m off by urban^2 -- about
  one every 12 s downtown, low-passed and in the reverb by distance like any
  far sound.
- It runs at 15 Hz (every level in it has a time constant of 0.25 s or more)
  and allocates nothing: one reused options object for `play()`.

Levels, as `audiorender` measures them (RMS): footsteps -35 dB, a car
passing -33, downtown on foot (bed, a horn, traffic voices) -35, a pier
(water, gulls, boards) -35, a park (birds, grass steps) -38 to -43, a rooftop
in the wind -35. The beds sit under the foreground; nothing in them is louder
than a car going by.

**What it costs**, perfcpu `--audio` at `--throttle=8` (radio off: its
station is random per car, and a synth station's notes are nodes):

| 8x, phone profile | master | this |
|---|---|---|
| drive-dt: rendered nodes, mean (max) | 44.1 (49) | 45-53 (50-61) |
| foot-dt: rendered nodes, mean (max) | 18.2 (22) | 24.8 (32) |
| drive-dt: `audio.update` ms/frame | 0.24 | 0.23 (another run 0.43: noise) |
| foot-dt: `audio.update` ms/frame | 0.35 | 0.39 |
| `_ambience` ms/frame | -- | 0.01 |
| bank: buffers, memory at 48 kHz | 66, 12.2 MB | 97, 15.2 MB |
| bank: main-thread graph building, total (worst batch) | 0.24 s (70-94 ms) | 0.31-0.42 s (72-136 ms) |

"Rendered" is a node on a path from a source still playing to the
destination. The counter's first version reported ~1000 on master: the
synth radio's per-note filter and gain stay connected after their
oscillator ends (until GC), and counting them as live measured the harness.
The one-shots add ~2 nodes on average (birds, horns), ~10 at most.

Rejected: the birds baked into a park loop (a 6 s loop of birdsong repeats
audibly; Poisson-timed one-shots never do, for less memory); a separate
wind source for the weather (the bed's band already exists and is always
rendered on foot); positional ambience beds (a bed is everywhere around you:
a panner would only cost a node).

Rules that each cost a debugging round:

- **Idle voices are DISCONNECTED, not muted** -- a graph that does not reach
  the destination is not rendered. Only the voice objects (`Tap`, the
  `_link`/`on` flags) may connect or disconnect.
- **Drive a param through `setp()` only**, which skips unchanged targets
  (51 -> 16 automation calls a frame, ~0.07 ms of `update()` on the Mac). It
  caches the last target on the param, so a direct `.value` or
  `setTargetAtTime` on the same param desyncs it.
- **`tools/audiorender.mjs` is the only way to hear it headlessly.** It drives
  the real `Audio` class with an OfflineAudioContext (`init(ctx)`, `_simT`)
  and writes `docs/audio/` WAVs (every bank sound, an enter-drive-exit run for
  every engine profile, pass-bys, crashes over the radio, footsteps, horns,
  water, a tunnel, the engine classes, the turbo's shifts, tyres, the crash
  tiers, a scrape, the ambience in four places), failing on clipping or
  silence. Scenes run under a seeded `Math.random`, so a render repeats.
  `--showcase` writes the short set in `apps/auto/docs/audio/` (22.05 kHz
  mono, ~5 MB): the files to listen to after a sound change. A spectrogram
  (any tool) is how to look at one without ears: shifts, blips, the whistle
  and the joints are all visible. An offline render
  schedules the whole script BEFORE rendering and graph changes are not
  scheduled events, so previews keep every voice linked (`keepLinked`) and
  must use `setValueAtTime`, not `.value`, for anything that changes mid-run.
  The voice cap prunes by END TIME, not `onended`: offline, nothing has ended
  when the next shot is queued, and cutting the "oldest" silenced a whole file.
