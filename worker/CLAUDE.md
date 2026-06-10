# Worker

Cloudflare Worker providing a KV storage API and the Kart 3 multiplayer room
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

### Kart 3 rooms (`/kart3/*` — NO Google auth by design)

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
`apps/kart3/index.html` (`netHandle`) and `apps/kart3/VISION.md`.
Rooms self-destruct via alarm after 45 min or when the last socket leaves.

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
