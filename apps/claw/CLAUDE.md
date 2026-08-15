# Claw

A real claw machine at real scale. Portrait. Three.js + Rapier, one
self-contained `index.html`, no build step, fully offline once installed.

You aim a gantry with an on-screen arcade stick, hit DROP, and the machine does
the rest. Prizes you get into the chute are saved to a persistent prize shelf.

## Version Management

**Bump `const VERSION` in `index.html` once per PR** (rendered bottom-right by
`$('ver').textContent`; the static `V1` in the HTML is a fallback only — ruin
shipped four releases displaying "V1" because nothing wrote the constant to the
badge, which makes "did my fix land?" unanswerable). ASSERT the old value when
bumping. Bump `CACHE` in `sw.js` (`claw-vN`) when a deploy must reach installed
players promptly.

`sw.js` install must stay SHELL-ONLY — the pinned CDN files cache lazily via the
fetch handler and are copied forward in `activate`. See `apps/ruin/sw.js` for
the full account of why a fat install permanently strands iOS players.

## The payout schedule is the whole game

This is not a physics bug, it is the product. Real claw machines do not have a
constant grip: the operator sets a payout interval, and the claw closes at full
strength only on the play that clears it. Every other play closes with a grip
that physically cannot hold a plush.

- `save.pot` counts plays; `save.target` (8–14, hidden, re-rolled after every
  win) is the interval. `startPlay()` sets `strongPlay` from that comparison.
- **Closing force and holding force are separate**, as they are in the cabinet:
  the talons always draw in at `GRIP.CLOSE_K`, and only when the lift starts
  does the stiffness switch to `STRONG_K` or `WEAK_K`. Closing at the *holding*
  stiffness made the machine unwinnable — a strong grab slapped the plush out
  from under the claw before the talons could scoop it, so the sweep measured
  more grip strength producing *fewer* wins. It also means the close looks and
  sounds identical either way: you cannot tell whether the machine is paying
  until it starts to lift.
- On a weak play the grip additionally **fades** toward `GRIP.FADE_K` over the
  first 0.9 s of the lift — the classic "it had it, and then it just let go".
- The arrival jolt at the home corner (`travelPhase === 2`) is also real. It is
  the last chance for a *marginal* grab to fail — keep its amplitude low enough
  that it isn't a coin flip on every carry, or the paying play stops paying.

Never "fix" this by making the claw reliably strong. If a change makes the win
rate feel generous, it has broken the design.

## Physics is at real scale, so the torques are tiny

The machine is ~1 m wide, a plush weighs ~100 g, and holding one needs on the
order of 0.05 N·m at the hinge — while merely holding a finger open against
gravity needs a comparable amount. The usable band for the motor stiffnesses is
narrow and **not guessable**: the constants in `GRIP` came out of
`tools/clawgrip.mjs`, which plays N scripted grabs per candidate triple and
prints the win rates. Re-run it after touching finger mass, finger geometry,
friction, `GANTRY.yBot`, or plush density.

**The hinge axis nearly sank the whole app.** `RAPIER.JointData.revolute()`
takes ONE axis vector and applies it to *both* bodies' local frames. The
fingers were originally built as bodies pre-rotated by θ about Y with a shared
`(0,0,1)` axis — so the joint spent every step undoing that rotation, and only
finger 0 (θ = 0) ever hinged. The machine could not hold anything, and because
the symptom was "grip too weak", two full constant sweeps were burned tuning a
claw that was structurally broken. Every finger body is now axis-aligned, θ is
baked into the collider offsets and into an inner visual group, and the hinge
axis is the tangential `(sin θ, 0, cos θ)` — identical in both frames.

**The chute needs its kerb.** Without the raised lip on the two interior edges
of the hole, a plush shoved along the floor by the descending claw slides
straight in, so a grip far too weak to lift anything still won a quarter of its
plays and the payout schedule meant nothing. The prize has to go in from above.

Other load-bearing details:

- Fingers are dynamic bodies on revolute joints to a **kinematic** head, with
  `setContactsEnabled(false)` and the `G_CLAW` collision group so they never
  collide with each other or the hub. Grip comes from friction, not from a
  hand-written "carry the prize" attachment — the prize is never parented.
- `world.timestep = 1/120` with up to 5 substeps per frame. At 1/60 the fingers
  tunnel through plush colliders and the grab reads as a ghost.
- The initial pile is settled with the chute **capped** and any plush resting
  over the hole relocated. Without the cap the collapsing stack posts a free
  prize into the bin before the first coin is inserted.
- `STOCK` is 26 on purpose. A plush lying flat on bare floor cannot be scooped
  — the talons hit the floor beside it — so a sparse machine is a machine you
  cannot beat. Packing it is a grip fix as much as a look fix.
- `GANTRY.yBot` must keep the open talons above the floor: they reach ~0.169 m
  below the hub, and driving them through the floor splays them open. Re-derive
  it if `FING` or `GRIP.OPEN_A` changes.
- The cabinet body is built AROUND the prize-bin cavity (`DOOR`), not as a
  solid box with a hole in its front skin — a solid core walls the bin in, and
  the entire payoff happens behind opaque panelling.
- `GRIP.REL_A` (the release gape) is deliberately WIDER than `GRIP.OPEN_A` (the
  descent gape), and the joint limits are set from `REL_A`. A plush wedged in
  the basket does not fall out of a 0.40 rad opening — it rides the gantry into
  the next play. The `open` phase also jiggles the head and, if something is
  still held when the phase should end, shakes harder and retries up to three
  times before moving on.
- Plush colliders are a handful of balls derived from the same `buildPlush()`
  call that makes the mesh, so what you see is what the claw touches. Add a
  visual flourish with `phys: false` if it should not be grabbable.

## Verification

```bash
python3 -m http.server 8000 &
node tools/clawtest.mjs --shots      # boot, stock, grabs, canvas layout, shelf
node tools/clawgrip.mjs --n 8        # the grip constant sweep
node tools/clawicon.mjs              # re-render the Home Screen PNGs
```

`clawtest.mjs` measures **carried** (a prize in the claw at the top of the
lift) as well as **won**, because a win alone also counts a plush bulldozed
into the hole and tells you nothing about the grip. Healthy numbers: strong
carries ~6-8/8 and wins ~5/8 (the arrival jolt takes the rest); weak wins ≤1/8.
It also asserts nothing is still in the claw once the release is over.

`__claw.pick()` — not `nearest()` — is what the harnesses aim with: the highest
plush inside the gantry's reach and clear of the chute kerb, i.e. what a player
would go for. Aiming at the *nearest* plush fixated on whatever was parked in
the chute corner, an unreachable trap, and reported sixteen straight failures
on the same bunny as though the grip had regressed.

`clawgrip.mjs` interleaves its candidates — one round of each before the second
round of any. Running them as sequential blocks was order-confounded: the pile
drifts as it is played and restocked, so whichever candidate ran last always
looked worst.

`clawtest.mjs` must dismiss the win card while waiting on a phase: the win
screen pauses the simulation, so a plush that slides into the bin a beat late
otherwise freezes the phase machine and the harness deadlocks.

## Icon

`gen-icon.html` draws the tile on a 2D canvas; `tools/clawicon.mjs` renders it
headless and writes `icon-180/192/512.png`. No binary assets are hand-edited.
