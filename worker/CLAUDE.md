# Worker

Cloudflare Worker providing a KV storage API and the Fable Kart multiplayer room
backend. Built with Hono and deployed via Wrangler.

## Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono
- **Storage:** Cloudflare KV (bound as `KV`)
- **Realtime:** `Kart3Room` Durable Object (`src/kart3room.ts`, SQLite-backed,
  WebSocket hibernation)
- **Auth:** Google JWT verification (single-user lockdown) for `/kv/*` etc.

## API

All `/kv/*` routes require `Authorization: Bearer <google-id-token>`.

- `GET /` — health check
- `GET /kv/:key` — read a value
- `PUT /kv/:key` — write a value (body = raw text)
- `DELETE /kv/:key` — delete a value

### Fable Kart rooms (`/kart3/*` — NO Google auth by design)

The routes keep the pre-rename "kart3" name on purpose — shipped clients
point at them.

Friends join with a room code, so these routes are origin-gated
(polkiewicz.com / maattp.github.io / any localhost port) instead of
email-locked. The unguessable 5-char code is the credential.

- `POST /kart3/rooms` → `{code}` — create a room (spins up a `Kart3Room` DO)
- `GET /kart3/rooms/:code` → `{exists, phase, players}` — status probe
- `GET /kart3/rooms/:code/ws` — WebSocket into the room DO. **This route is
  registered BEFORE the cors middleware** — cors() mutates response headers
  and a 101 WebSocket response's headers are immutable. Keep it there.

The DO is a lobby (roster/chars/ready/host) + opaque message relay:
client `input` → host; host `snap`/`event` → everyone else (or one peer via
`msg.to`); `rtc` relays WebRTC signaling peer→peer; `pp` echoes for RTT.
At race start it stores `seats` (id+name) so a player who drops mid-race
can rejoin by name and reclaim their kart. Protocol lives in
`apps/fablekart/index.html` (`netHandle`) and `apps/fablekart/VISION.md`.
Rooms self-destruct via alarm after 45 min or when the last socket leaves.

### Sichuan Mahjong rooms (`/mahjong/*` — NO Google auth, origin-gated like kart3)

Unlike `Kart3Room` (an opaque relay), `MahjongRoom` (`src/mahjongroom.ts`) is
**server-authoritative**: the DO runs the shared rules engine
(`src/mahjongCore.js` — the *same* file the browser inlines for local play) and
is the sole holder of hidden state. Each client is sent only its own redacted
`viewFor()` snapshot, so no client ever sees another player's concealed tiles
(the anti-cheat property a host-authoritative model can't give a hidden-info
game). Hibernation-safe: the whole engine state lives in DO storage as plain
JSON; every message loads → mutates → saves → broadcasts. Bots run server-side,
paced by the alarm. Disconnect → that seat is taken over by a bot so the hand
continues; the human can rejoin by name. 45-min idle TTL.

- `POST /mahjong/rooms` → `{code}` — create a room
- `GET /mahjong/rooms/:code` → `{exists, phase, players}` — status
- `GET /mahjong/rooms/:code/ws` — WebSocket (registered BEFORE cors, same as kart3)

Client protocol (`apps/mahjong/index.html`, `OnlineConnection`): `hello` →
`welcome`; lobby `ready`/`config`/`start`/`rematch`; in-game `action` → server
validates via the engine and replies `view` (redacted) or `reject`.

**Engine sync:** `src/mahjongCore.js` is the canonical engine. The identical
region (between `==CORE-START==`/`==CORE-END==`) is inlined into the app by
`node apps/mahjong/build-core.mjs`; `node tests/core-sync.mjs` asserts no drift.
Engine tests: `node worker/test/core.test.mjs`.

## Auth

Google ID tokens are verified using Google's public JWKS keys via the Web Crypto API. The middleware checks:
- JWT signature
- Issuer (`accounts.google.com`)
- Audience (must match `GOOGLE_CLIENT_ID`)
- Expiry
- Email (must match `ALLOWED_EMAIL`)

## Environment Variables

Set in `wrangler.toml`:
- `GOOGLE_CLIENT_ID` — Google OAuth client ID
- `ALLOWED_EMAIL` — the single email allowed to access the API

## Development

```bash
cd worker
npm install
npm run dev       # local dev server
npm run deploy    # deploy to Cloudflare
npm run typecheck # type check
```

## Deployment

Auto-deploys on push to `master` when files in `worker/` change. See `../.github/workflows/deploy-worker.yml`. Requires `CLOUDFLARE_API_TOKEN` repo secret.
