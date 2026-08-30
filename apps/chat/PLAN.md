# Chat app — plan

A real chat app at `/apps/chat/`, with three participants: Matt, Tingting, and
Claude. Installable as an iOS PWA, readable offline, pushes notifications, and
stays fast with tens of thousands of messages in a thread.

Nothing here is built yet. This is the design to argue with before writing code.

## Why this exists

The Pebble ring can already reach a Claude session, but the channel is one-way:
Claude's only reply is a push notification, so there is no way to go back and
forth. A chat app gives Claude a return path and a place to be a participant
rather than a notifier.

The shape of a real use case: ring the ring, say "research date ideas", iterate
with Claude privately, and when one is good, put it in the thread Tingting can
see — posted as Claude, clearly not as Matt.

## Device senders

Matt's input devices are participants of their own: a ring press is recorded
in `dm` as sender `ring` (an Alexa would be `alexa`). The relay's credential is
the identity — same stamping rule as everything else. `DEVICE_OWNERS` maps a
device to its human so the owner is never push-notified about their own voice.

**There is exactly one delivery path to Claude: the chat feed.** The old
direct pebble envelope is gone — a press is written to `dm` and forwarded from
there like any typed message, and the channel server keeps a per-thread cursor
so it catches up from the feed after downtime. A press that lands while the
agent is down is delivered late instead of dropped; the relay's ack tells Matt
which happened ("will reply" vs "offline, will pick it up"). Reply rules key
off the sender, not the transport: in-thread always, plus a phone push when
sender is `ring`.

From the ring, destination is chosen verbally: naming the coordinator →
`send_to_coordinator` (dm, private); naming the group/our chat →
`post_to_group_chat` (shared feed, Tingting sees it).

## Threads

Two, fixed. No thread creation UI, no thread list to manage.

| Thread | Members | Purpose |
|--------|---------|---------|
| `dm` | Matt, Claude | Private. Drafting, research, iterating. Tingting cannot see it or know it exists. |
| `group` | Matt, Tingting, Claude | Shared. Where finished things land. |

A message is promoted from `dm` to `group` by an explicit action — a "send to
group" affordance on a message, which copies it into `group` attributed to
whoever promoted it. Claude never posts to `group` on its own initiative in v1.

## Identity — the one rule that must not bend

**The server assigns `sender` from the credential used. It is never read from
the request body.**

- Matt and Tingting authenticate with a Google ID token exchanged for an opaque
  session UUID — the existing `POST /auth` flow, gated on `ALLOWED_EMAILS`,
  which already contains exactly their two addresses. The worker maps session →
  email → `sender`.
- Claude authenticates with its own bearer token (`CHAT_CLAUDE_TOKEN`, a
  wrangler secret) on a separate route. The worker stamps `sender = 'claude'`.

Consequences that fall out for free: a human session physically cannot post as
Claude, Claude's token cannot post as a human, and "is this really from Claude"
is answered by the database column rather than by a UI convention that a
rendering bug could undermine. Claude's messages render with a distinct bubble,
an explicit "Claude" label, and no avatar that could be mistaken for a person.

## Storage — what lives where

Five stores, four of them already bound to the worker.

| Store | Role here | Status |
|-------|-----------|--------|
| **D1** (`photos-db`) | Source of truth: messages, reactions, read state, push subs, attachment metadata | Already bound as `DB`; also holds the `hard_` tables |
| **Durable Object storage** | Nothing authoritative — only `seq` allocation state and socket bookkeeping | New `ChatRoom` DO |
| **KV** | Session UUIDs (existing) and single-use WebSocket tickets | Already bound as `KV` |
| **R2** | Attachment blobs under `chat/` | Already bound as `PHOTOS` |
| **IndexedDB** (client) | Local cache of messages/reactions + the send outbox. Evictable; never the only copy | New |

D1 is a real SQLite database and comfortably handles tens of thousands of rows;
the constraint is query shape, not size — every read bounded by `LIMIT` and
served by the `(thread, seq DESC)` index.

## Data model (D1)

All tables `chat_`-prefixed, following the `hard_` convention.

```sql
chat_messages (
  id           TEXT PRIMARY KEY,     -- client-generated UUID; the idempotency key
  thread       TEXT NOT NULL,        -- 'dm' | 'group'
  seq          INTEGER NOT NULL,     -- monotonic per thread; the sync cursor
  sender       TEXT NOT NULL,        -- 'matt' | 'tingting' | 'claude' — server-assigned
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,     -- server clock, ms
  client_at    INTEGER,              -- device clock, for ordering hints only
  reply_to     TEXT,                 -- message id, nullable
  edited_at    INTEGER,
  deleted_at   INTEGER,              -- soft delete; tombstones must sync
  UNIQUE (thread, seq)
)
CREATE INDEX chat_messages_thread_seq ON chat_messages (thread, seq DESC);

chat_reactions (
  message_id   TEXT NOT NULL,
  sender       TEXT NOT NULL,        -- server-assigned, same rule as messages
  emoji        TEXT NOT NULL,
  seq          INTEGER NOT NULL,     -- own slot in the thread stream, so it syncs
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (message_id, sender, emoji)
)
CREATE INDEX chat_reactions_message ON chat_reactions (message_id);

chat_reads (thread, sender, last_seq, updated_at)   -- read receipts / unread badges
chat_push_subs (endpoint PRIMARY KEY, email, p256dh, auth, created_at)
chat_attachments (id, message_id, r2_key, mime, bytes, width, height)
```

`seq` is allocated by the Durable Object, not by SQLite autoincrement, so
ordering is decided in one place and clients can sync on "everything after N".

## Realtime — `ChatRoom` DO

Model it on `HardRoom`, which already does exactly this shape for the same two
people: **D1 is the source of truth, the DO serialises writes and fans out, and
the DO stores nothing authoritative.**

- One instance per thread: `idFromName('dm')`, `idFromName('group')`. Separate
  instances mean the private thread's sockets and the group's are physically
  distinct, so a fan-out bug cannot leak `dm` into `group`.
- WebSocket hibernation, so idle threads cost nothing.
- The DO's input gate serialises `seq` allocation — no gaps, no duplicates.
- **Broadcast after commit**: write to D1, then push to sockets. Never the
  reverse, or a failed write becomes a message that appeared and then vanished.
- The upgrade route must be registered **before** `cors()` in `index.ts` — a 101
  response's headers are immutable, the same constraint kart3/mahjong/hard hit.
- Browsers cannot set an `Authorization` header on a WebSocket, so reuse the
  75 Hard ticket pattern: `POST /chat/ws-ticket` (session-gated) mints a
  single-use 60s ticket in KV, `GET /chat/ws?ticket=` redeems it.

## Reactions

Everyone reacts: Matt, Tingting, and Claude. Same identity rule as messages —
the server stamps `sender` from the credential, so a reaction from Claude is
provably from Claude.

For the humans this is ordinary chat furniture. For Claude it is the **status
channel**, and it earns its place: Claude works in bursts over seconds to
minutes, so a typing indicator would be a fiction. A reaction is a durable mark
on the specific message being worked on, it survives a reload, and it needs no
new UI surface.

**Claude's working vocabulary** — a small reserved set, documented in the ring
agent's `CLAUDE.md` so it is used consistently:

| Emoji | Means |
|-------|-------|
| 👀 | Seen it, starting |
| ⏳ | Working — expect a real reply |
| ✅ | Done; the answer is in the thread |
| ⚠️ | Blocked or refused; read the reply |

The progression replaces one reaction with the next (`⏳` is removed when `✅`
lands) so a message carries one Claude state at a time. Humans are not
restricted to this set.

**Operations are explicit `add` and `remove`, never `toggle`.** A toggle is not
idempotent: an ambiguous failure followed by a retry flips it back and the user
sees their reaction vanish. Explicit ops make the offline outbox safe, the same
reason message sends carry a client-generated UUID.

**Reactions occupy the thread's `seq` stream**, so an offline client catching up
with `?after=<last_seq>` receives reaction changes alongside messages rather
than needing a second sync path. They broadcast over the same socket, after
commit, like everything else.

Caps: a bounded set of distinct emoji per message, and a per-sender rate limit —
a runaway agent must not be able to write thousands of rows onto one message.

Reactions never generate a push notification. A phone buzzing because something
was marked ⏳ is exactly the kind of notification that trains people to ignore
notifications.

## Sync protocol

Every client keeps `last_seq` per thread.

- **Cold start**: `GET /chat/:thread/messages?before=<seq>&limit=50` — newest
  first, paged backwards.
- **Reconnect**: `GET /chat/:thread/messages?after=<last_seq>` — the delta.
  If the gap is larger than a threshold, the client refetches the tail instead
  of streaming thousands of rows.
- **Live**: the socket delivers each committed message.
- **Send**: `POST /chat/:thread/send` with a client-generated UUID. Re-sending
  the same UUID returns the original message rather than creating a second —
  the same idempotency ledger idea as `hard_actions`. This is what makes the
  offline outbox safe to retry.

Tombstones sync like messages: a delete bumps `seq` so offline clients learn
about it. Reaction add/remove does the same — one ordered stream per thread
carrying messages, deletions, and reactions means one cursor and one catch-up
path.

## Offline and PWA

Read-only offline is the target: the full thread is readable with no network,
and sends queue until there is one.

**Service worker** (`apps/chat/sw.js`, `CACHE = 'chat-vN'`, bumped in lockstep
with `VERSION` in `index.html` — the convention the auto/claw/zombies apps
already follow, and the reason a stale worker is distinguishable from a
non-landing fix).

- App shell (HTML/CSS/JS) — cache-first, so launch works offline.
- API calls — network-first with no cache; message data lives in IndexedDB, not
  in the HTTP cache.

**IndexedDB** is the local message store, not `localStorage` (wrong size class,
synchronous, and the app must survive tens of thousands of rows).

```
messages   keyPath 'id', index on [thread, seq]
outbox     queued sends awaiting connectivity
meta       last_seq per thread, session state
```

Send flow: write to `outbox` and render optimistically (greyed, "sending") →
POST → on success replace with the server row → on failure leave queued and
retry on reconnect. Because sends are idempotent by UUID, a retry after an
ambiguous failure cannot double-post.

**iOS specifics that will bite:**

- The app must be **installed to the home screen** before it can receive Web
  Push at all. Safari tabs get nothing. The UI needs an explicit "add to home
  screen" path, and must detect `display-mode: standalone` to know.
- Background Sync is unavailable. The outbox flushes on app foreground and on
  `online` events — there is no true background retry.
- Storage is evictable. IndexedDB is a cache to be repopulated from the server,
  never the only copy of anything.
- Standard set: `apple-mobile-web-app-capable`, `viewport-fit=cover`, safe-area
  insets, `-webkit-overflow-scrolling: touch`, and careful handling of the
  keyboard resizing the viewport (`visualViewport` listener) so the composer
  stays put.

## Scale — tens of thousands of messages

- **Virtualised list.** Only the visible window plus a small buffer is in the
  DOM. This is the single decision that determines whether the app is usable at
  20k messages, and it must be there from the first version — retrofitting a
  virtualiser into a working chat UI is a rewrite.
- **Page backwards on demand** from IndexedDB; hit the network only when the
  local store lacks the range.
- **Anchor scroll on resize and prepend** so loading older messages doesn't
  yank the viewport.
- D1 queries always bounded by `LIMIT` and served by the `(thread, seq DESC)`
  index. No unbounded `SELECT *`.
- Message body capped (say 8KB) so one paste cannot wedge a thread.

## Push notifications

The hard part already exists in `worker/src/hardpush.ts` — hand-rolled RFC 8291
(aes128gcm) and RFC 8292 (VAPID) on WebCrypto, deliberately not a library
because the available ones emit legacy `aesgcm` that Apple rejects. It is
covered by `test/push.test.mjs`, which proves the round-trip by decrypting with
the subscriber's private key.

- **Reusable as-is**: `encryptPushPayload`, `vapidAuthorization`,
  `buildPushRequest`. These take raw arguments and know nothing about 75 Hard.
- **Not reusable**: `sendPushToUser` / `sendPushes`, which query `hard_users`,
  `hard_push_subs`, `hard_days`. A small `sendChatPush` over `chat_push_subs`
  replaces them.
- The existing VAPID keypair can be reused; `VAPID_PRIVATE_KEY` is already a
  secret and the public half is already in `wrangler.toml`.
- **Only notify a recipient with no live socket for that thread**, or the phone
  buzzes for a message already on screen.
- Prune subscriptions on 404/410, as `hardpush` already does.

⚠️ 75 Hard has never been used in anger, so this push path has passed its unit
tests but has probably never lit up a real iPhone lock screen. **Prove one real
notification end to end before designing around it.**

## How Claude participates

Claude is the ring agent (`~/dev/ring-agent`), not the coordinator.

- **Posting**: the ring agent's channel server gains a reply tool,
  `post_to_chat(thread, text)`, which POSTs to `/chat/:thread/send` with
  `CHAT_CLAUDE_TOKEN`. This makes the ring channel two-way, which the channels
  contract explicitly supports.
- **Receiving**: a message in `dm` (or one in `group` that @-mentions Claude) is
  pushed down the same WebSocket the ring already uses, arriving as a channel
  event with `source="chat"`. `via` distinguishes it from a ring press so the
  agent knows whether to answer in the thread or by push notification.
- **Status**: on receiving a chat message the agent reacts 👀, switches to ⏳
  while working, and lands ✅ (or ⚠️) when done. Reacting is cheap and immediate,
  so Matt gets "it heard me" long before the reply exists — which is the whole
  problem with a one-way channel whose answers take a minute.
- **Ring → chat flow**: ring press starts the task, the agent replies in `dm`,
  Matt iterates there, and promotion to `group` is Matt's explicit act.

This also removes the reason the ring agent currently cannot message anyone:
posting *as Claude* into a two-reader app is categorically different from
sending an iMessage *as Matt*. It is attributed, bounded, and visible.

## Security

- Identity is server-assigned from the credential. Never trust a `sender` field.
- `ALLOWED_EMAILS` is re-checked on every authed request, so removing an address
  kills live sessions — the existing behaviour.
- Claude's token is separate from both ring tokens. Three tokens, three jobs:
  Pebble→relay, mini↔relay socket, Claude→chat. Compromise of one must not
  grant the others.
- Rate-limit `/chat/*/send` per credential. Claude's token especially: if it
  leaked, the blast radius is "writes into a thread Tingting reads".
- Render message bodies as **text nodes**, never `innerHTML`. Strict CSP on the
  page. The threat is not a stranger — it is Claude posting fetched content that
  happens to contain markup.
- Attachments in R2 under `chat/`, served only through a session-gated route.
- Never log message bodies in the worker.

## Open questions

1. **Edit and delete** — worth the tombstone sync complexity, or is v1
   append-only?
2. **Presence** — worth showing who is connected? Claude's working state is
   handled by reactions, which is more honest than a typing indicator, so this
   is only a question for the two humans.
3. **History limit** — does the local store keep everything forever, or a
   rolling window with older messages fetched on demand?
4. **Should Tingting see that `dm` exists?** Hiding it entirely is simplest and
   least weird. Showing "Matt is talking to Claude" is more honest but invites
   questions.
5. **What can Claude do from a chat message?** The chat is a stronger auth path
   than the ring (real Google session), so the permission set could reasonably
   be wider — but the ring agent is the one executing, and it is deliberately
   the narrow agent.

6. **Which D1 database?** The existing binding is `photos-db`, which already
   hosts the `hard_` tables — so it is already a general-purpose database with a
   misleading name. Reusing it means one binding and one migration path; a
   separate `chat-db` is cleaner but adds a binding and rules out any future
   join. Leaning reuse.
7. **What context does Claude get?** The biggest unanswered question. At 20k
   messages the thread does not fit in a context window, so something must
   choose: last N messages, the current session only, a rolling summary, or
   retrieval over the thread. Getting this wrong makes Claude feel amnesiac in a
   thread that visibly contains the answer. It affects the schema — a summary
   table would live in D1 — so it should be settled before M5, not after.
8. **How does anyone know Claude is down?** If the ring agent is not attached,
   a message to Claude sits there looking ignored. Presence for Claude is not
   cosmetic: it is the difference between "thinking" and "nobody is home". The
   relay already exposes attachment state, so the app can show it.
9. **Multi-device.** Matt on phone and desktop simultaneously: read state has to
   converge, and a notification should not fire on a device that already has the
   message on screen. `chat_reads` is per-sender, not per-device, which is
   probably right but means "read on one device" marks it read everywhere.
10. **Offline sends that surface late.** A message composed offline at 9am and
    uploaded at 5pm gets a 5pm `seq`. Does it appear at the bottom (accurate to
    the server, confusing to the sender) or slotted by `client_at` (intuitive,
    but then ordering is not the same for everyone)? Bottom is simpler and
    defensible; worth a visible "sent 9am" label.
11. **Lock-screen privacy.** Does the push carry the message body, or just
    "Tingting sent a message"? Body is far more useful and is visible to anyone
    holding the phone.
12. **Backup.** If IndexedDB is a disposable cache and D1 is truth, the thread
    exists in exactly one place. For a thread that accumulates years of a
    relationship, an export path is worth having before it matters.

## Decisions (2026-08-30)

Open questions resolved by assumption so implementation can start. Each is
cheap to revisit; none is load-bearing enough to block on.

1. **Append-only v1.** No edit or delete UI. The schema keeps `edited_at` /
   `deleted_at` so adding them later is a route, not a migration.
2. **No presence for humans.** Claude's state is reactions; whether Claude is
   *reachable* comes later from the relay's attachment status.
3. **Keep everything.** No history cap; paging handles size.
4. **`dm` is invisible to Tingting.** Membership is enforced server-side per
   thread; her session simply cannot address it.
5. **Chat grants no extra authority.** A chat message to Claude carries the same
   permissions as a ring request — the ring agent's CLAUDE.md governs both.
6. **Reuse `photos-db`** (Matt's call). All tables `chat_`-prefixed.
7. **Claude context: last 50 messages** of the thread on each wake, plus
   whatever its session already holds. Summaries/retrieval deferred until the
   thread outgrows this.
8. **Claude-down indicator deferred** to M5 alongside the rest of the Claude
   integration.
9. **Reads are per-sender, not per-device.** Read on one device = read
   everywhere.
10. **Late offline sends order by server `seq`** — they land at the bottom,
    with `client_at` shown as a "composed at" label.
11. **Push carries the message body.** Lock-screen visibility accepted for a
    two-person household.
12. **Backup deferred**, but v1 ships `GET /chat/:thread/export` (session-gated,
    full JSON) so the data is never hostage.

Sender identity mapping lives in a `CHAT_SENDERS` var
(`email:name,email:name`), not hardcoded in source. Claude's credential is a
`CHAT_CLAUDE_TOKEN` wrangler secret, constant-time compared like the ring
tokens. Rate limits are enforced in the DO (its input gate serialises anyway):
30 messages and 60 reaction ops per sender per minute.

## Non-goals (v1)

Group creation, more members, voice or video, message search across threads,
end-to-end encryption (the server must read messages for Claude to participate),
web-only push without installing, Android.

## Build order

1. **M1 — skeleton.** `chat_messages`, `ChatRoom` DO for `group` only, send +
   list over HTTP, no realtime, no offline. Prove identity stamping works and
   that a human cannot post as Claude.
2. **M2 — realtime.** WebSocket with the ticket handshake, broadcast after
   commit, live append in the UI.
3. **M2.5 — reactions.** Table, add/remove routes, broadcast, and the picker.
   Small once realtime exists, and it makes M5 much better because Claude can
   signal before it can usefully speak.
4. **M3 — the app.** Service worker, IndexedDB, virtualised list, offline read,
   outbox. This is the biggest step by some distance.
5. **M4 — push.** `chat_push_subs`, `sendChatPush`, install-to-home-screen flow.
   Prove one real notification first.
6. **M5 — Claude.** `post_to_chat` reply tool, inbound chat → channel event,
   the `dm` thread, promotion to `group`.

M1 through M3 are useful on their own as a two-person chat. Claude can arrive
last without changing anything already built.
