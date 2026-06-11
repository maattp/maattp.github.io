# Kart 3 — Multiplayer Vision

The end goal: **really solid 2–4 player multiplayer.** I can open Kart 3 on my
phone, create a private room, send three friends a code (or have matchmaking
pair us), and race a full Grand Prix together over the internet — or sitting
in the same room. Stretch: voice chat while racing.

This doc is the plan of record for getting there. The engine was structured
for this from day one (see "Foundation already in place" below) — what's left
is transport, backend, and lobby UX.

## Player experience targets

- **Private rooms**: host taps "Create Room" → gets a short code (e.g.
  `COVE7`). Friends tap "Join Room", enter the code, pick characters, ready
  up, race. Up to 4 humans; AI fill the remaining 4 grid slots so it's always
  an 8-kart race.
- **Matchmaking**: "Quick Race" queues you; pairs 2–4 strangers (or just
  whoever's online) into a room automatically. Same race flow after that.
- **In-person play**: same flow as private rooms. WebRTC with mDNS/host
  candidates means two phones on the same WiFi talk directly at LAN latency —
  no special "local mode" needed.
- **Full race fidelity**: items, drafting, bonks, rubber-banding vs the
  humans, results table with everyone's name. A race with 4 humans + 4 AI
  should feel identical to today's solo race.
- **Voice (stretch, nice-to-have)**: open mic or push-to-talk over the same
  peer connection. Less necessary than rock-solid racing — do last.

## Foundation already in place (don't regress these)

The four seams documented in `CLAUDE.md`:

1. **Deterministic seeded PRNG** — world from `WORLD_SEED`, race from
   `raceSeed`. Host broadcasts `{raceSeed, roster}` → identical item rolls
   and AI behavior everywhere.
2. **Controller abstraction** — physics only reads `k.ctrl {steer, brake,
   drift, fire}`. A remote player is a controller fed from packets;
   `localController`'s output is what we send. AI controllers run host-side
   for fill karts.
3. **Fixed-step sim** — 60Hz numbered ticks (`simTickNo`), gameplay fully
   separated from rendering. Snapshots/inputs reference tick numbers.
4. **`netSnapshot()` / `netRestore()`** — full race-state serialization,
   verified exact round-trip. This is the state-sync payload.

## Architecture

### Netcode model: host-authoritative state sync

One peer (room creator) is the **host** and runs the only authoritative sim,
including all AI karts:

- Clients send their `ctrl` inputs (~30Hz, tiny packets) tagged with tick.
- Host applies them, sims at 60Hz, broadcasts compact snapshots ~12–15Hz
  (delta of `netSnapshot`, quantized).
- Clients **predict their own kart locally** (same physics, same controller)
  and reconcile against host snapshots; **remote karts interpolate** between
  snapshots (~100ms display delay).

Why not deterministic lockstep: it's the cheapest bandwidth but one stalled
phone stalls everyone, iOS Safari timer jitter makes it fragile, and any
float divergence desyncs the whole race. State sync is tolerant, supports
late joins/reconnects via a full `netSnapshot`, and we already have the
serialization. Cheating is a non-concern (friends + casual matchmaking).

### Transport: WebRTC DataChannels, Worker relay as fallback

- **Primary**: `RTCDataChannel`, star topology (host ↔ each client).
  - unordered/unreliable channel (`maxRetransmits: 0`) for inputs + snapshots
  - reliable ordered channel for lobby/events (item announcements optional —
    they're derivable from snapshots)
  - STUN: public Google/Cloudflare STUN is fine. No TURN server: when P2P
    fails (CGNAT/symmetric NAT), fall back to the relay below instead of
    paying for TURN.
- **Fallback + signaling**: WebSocket relay on the Cloudflare Worker (see
  backend). Latency is worse but Cloudflare's edge is close to everyone;
  a relayed 4-player race is still very playable at this sim rate.
- In-person: WebRTC negotiates direct LAN paths automatically — nothing
  extra to build.

### Cloudflare backend (`worker/`)

Today the worker is a Hono KV API **locked to a single Google account** —
friends can't authenticate against it. Multiplayer endpoints must be a new,
separately-authed namespace; keep `/kv/*` locked down as-is.

Add:

- **`Room` Durable Object** — one per room code. Responsibilities:
  - WebSocket hub (use the WS Hibernation API to keep costs ~zero)
  - roster + lobby state (names, chars, ready flags), host designation
  - WebRTC signaling relay (offer/answer/ICE between peers)
  - message relay fallback when a peer pair can't go P2P
  - room lifecycle: created → lobby → racing → results → idle timeout (~5 min)
- **Routes** (no Google auth; anonymous session token issued per device,
  rate-limited):
  - `POST /kart3/rooms` → `{code}` (4–5 chars, unambiguous alphabet)
  - `GET /kart3/rooms/:code/ws` → WebSocket upgrade into the DO
  - `POST /kart3/queue` → matchmaking: a tiny queue DO (or KV with TTL)
    that groups 2–4 waiting players, creates a room, returns the code.
    Solo-after-timeout: ~20s with at least 1 match → start; nobody → suggest
    private room vs AI.
- `wrangler.toml`: DO bindings + migration; deploy flow unchanged
  (auto-deploys from `master`).

### Race protocol (happy path)

1. Lobby (DO, reliable WS): roster, char picks, ready. Host picks AI fill.
2. Host sends `start {raceSeed, roster[], charIdx[], laps}`; everyone builds
   karts identically (same call order — already deterministic).
3. Signaling → DataChannels open; peers that fail stay on the WS relay.
4. Synced countdown: host announces `goAt` (host clock + offset estimation
   from ping); GO is cosmetic anyway — host sim is truth.
5. Racing: inputs up, snapshots down, local prediction + interpolation.
6. Finish: host's results are final; standings show player names.

### Edge cases (decide early, keep simple)

- **Client disconnect**: their kart converts to an AI controller host-side;
  rejoin within ~30s via full `netSnapshot` restore.
- **Host disconnect**: race ends gracefully with "host left" + current
  standings. Host migration is a v2 nicety (snapshot + DO re-elects).
- **Backgrounded phone** (call/notification): treat as disconnect+rejoin;
  never pause the shared race.
- **Versioning** ✅ *(shipped)*: every `hello` carries `NET_VER` (= `APP_VER`,
  bumped per PR, + a hash of track/physics data); the room rejects joiners
  whose tag differs from the host's with a "close and reopen the app"
  message instead of desyncing.

### Voice (stretch)

Add an audio track to the existing host-star `RTCPeerConnection`s (host mixes
nothing — 3 remote tracks play directly; at 4 players that's fine). Mute
button + push-to-talk; duck game audio while someone talks. Relay-fallback
peers simply don't get voice (data races fine without it). Do this only once
racing is rock solid.

## Milestones

1. **M1 — Rooms + relay racing** ✅ *(shipped)*: Room DO, lobby UI, 2 humans
   over the WS relay end-to-end (no WebRTC yet). Proved protocol, prediction,
   interp (own-kart divergence ~2u on localhost). Learning for M2: relay
   latency makes the host sim clients' karts on stale steering — consider
   client-authoritative own-kart pose (fine at this trust level) or input
   delay buffering alongside WebRTC.
2. **M2 — WebRTC + full grid** ✅ *(shipped)*: DataChannels with relay
   fallback (dual-send + tick dedupe, lobby-pre-warmed), client-authoritative
   own-kart pose (host keeps items/laps/ranks; fixed M1's stale-steering),
   disconnect→AI conversion, auto-rejoin by seat name with full-state
   restore, client rocket starts, P2P/RELAY + RTT indicator.
3. **M3 — Matchmaking**: quick-race queue, names/avatars, polish lobby.
4. **M4 — Resilience polish**: host clock sync hardening, jitter buffers,
   reconnect UX, version gating.
5. **M5 — Voice** (optional): audio tracks, PTT/mute UI.

Each milestone should be verifiable headless: two CDP-driven browser pages
racing each other against a `wrangler dev` worker is the integration test.

## Non-goals

- More than 4 humans (8 with AI fill is the format).
- Server-side physics (host-authoritative is enough at this trust level).
- Anti-cheat, rankings, persistence beyond best-times (already local).
- Spectator mode (maybe someday; snapshots make it cheap, but not now).
