# Worker

Cloudflare Worker providing a KV storage API, the photos backend, the Fable
Kart / Mahjong multiplayer rooms, and the 75 Hard couples-tracker backend.
Built with Hono and deployed via Wrangler.

## Stack

- **Runtime:** Cloudflare Workers (default export is `{ fetch, scheduled }` —
  the `scheduled` cron handler lives in `src/hardcron.ts`)
- **Framework:** Hono
- **Storage:** KV (`KV`), D1 (`DB`, database `photos-db`), R2 (`PHOTOS`)
- **Realtime:** `Kart3Room`, `MahjongRoom`, `HardRoom` Durable Objects
  (SQLite-backed, WebSocket hibernation)
- **Auth:** Google ID token verified once at `POST /auth` → opaque session UUID
  in KV (1yr TTL); every authed request re-checks the `ALLOWED_EMAILS` allowlist

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

Google ID tokens are verified using Google's public JWKS keys via the Web Crypto API at `POST /auth`, which then issues an opaque session UUID (KV, 1-year TTL). Verification checks:
- JWT signature
- Issuer (`accounts.google.com`)
- Audience (must match `GOOGLE_CLIENT_ID`)
- Expiry + `email_verified`
- Email must be in `ALLOWED_EMAILS` (comma-separated allowlist, re-checked on
  every session-authed request — removing an email locks out live sessions)

## 75 Hard (`/hard/*` — see `apps/75hard/`)

Two-person couples tracker. All routes session-gated except the WS upgrade.

- **Files:** `src/hard.ts` (routes), `src/hardroom.ts` (`HardRoom` DO),
  `src/hardlogic.ts` (pure day-boundary/reset engine — **mirrored verbatim in
  the app's inline JS; keep both in sync**), `src/hardpush.ts` (Web Push),
  `src/hardcron.ts` (cron), `schema-hard.sql` (D1 tables, all `hard_`-prefixed).
- **Architecture:** D1 is the source of truth. Every mutation flows through the
  single `HardRoom` DO instance (`idFromName("couple")`) whose input gate
  serializes writes; it holds the WebSockets and broadcasts after commit. The DO
  stores nothing authoritative.
- **Sync:** `POST /hard/sync` takes batched client actions
  `{actionId, type, payload, date, localTimestamp, timezone}`; idempotent via
  the `hard_actions` ledger; per-action acks `applied|duplicate|late|rejected`.
  Day finalization (miss → reset, milestones, day-75 completion) runs lazily on
  every apply/state AND on the cron tick; team mode resets both partners in one
  `db.batch()`.
- **WS:** `GET /hard/ws?ticket=` — ticket from `POST /hard/ws-ticket` (60s,
  single-use, in KV). Registered BEFORE cors in index.ts (immutable 101
  headers, same as kart3).
- **Photos:** R2 keys `hard/original/<id>` + `hard/thumb/<id>`; metadata in
  `hard_photos`; partner can read only `shared=1` photos.
- **Push:** `@block65/webcrypto-web-push` (VAPID + aes128gcm on WebCrypto).
  Subs in `hard_push_subs` (endpoint PK); 404/410 responses prune the row.
- **Cron:** `*/15 * * * *` — per-user local-time reminders, bedtime nudge,
  at-risk partner warnings (exactly-once via `hard_notif_log` PK +
  `INSERT OR IGNORE`), finalization kick, table pruning.
- **Tests:** `node --experimental-strip-types worker/test/hard.test.mjs` (pure
  logic) and `node worker/test/hard.integration.mjs` (against `wrangler dev
  --test-scheduled`; see file header for KV session seeding).

## Environment Variables

Set in `wrangler.toml`:
- `GOOGLE_CLIENT_ID` — Google OAuth client ID
- `ALLOWED_EMAILS` — comma-separated allowlist (the couple's two accounts)
- `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` — Web Push VAPID config

Secrets (NOT in wrangler.toml):
- `VAPID_PRIVATE_KEY` — `wrangler secret put VAPID_PRIVATE_KEY` in production;
  `worker/.dev.vars` (gitignored) for local dev. The keypair was generated at
  setup; the public half is baked into `wrangler.toml` and `apps/75hard/index.html`.

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
