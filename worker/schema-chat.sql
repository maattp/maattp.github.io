-- Chat app tables (apps/chat/). All chat_-prefixed, in photos-db alongside
-- the hard_ tables. Applied with:
--   npx wrangler d1 execute photos-db --remote --file=schema-chat.sql
-- Everything is IF NOT EXISTS so re-applying is safe.

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,   -- client-generated UUID; the idempotency key
  thread     TEXT NOT NULL,      -- 'dm' | 'group'
  seq        INTEGER NOT NULL,   -- allocated by the ChatRoom DO; the sync cursor
  sender     TEXT NOT NULL,      -- 'matt' | 'tingting' | 'claude' — server-assigned
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,   -- server clock, ms
  client_at  INTEGER,            -- device clock; display hint only
  reply_to   TEXT,               -- message id, nullable
  edited_at  INTEGER,            -- unused in v1 (append-only); kept so edit is a route not a migration
  deleted_at INTEGER,            -- unused in v1; same reasoning
  UNIQUE (thread, seq)
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_seq ON chat_messages (thread, seq DESC);

-- Reactions are tombstoned (removed_at), never deleted: a removal takes a new
-- seq so an offline client catching up on ?after=N learns about it. Current
-- state of a reaction = the row where removed_at IS NULL.
CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id TEXT NOT NULL,
  thread     TEXT NOT NULL,
  sender     TEXT NOT NULL,      -- server-assigned, same rule as messages
  emoji      TEXT NOT NULL,
  seq        INTEGER NOT NULL,   -- bumped on every add/remove; shares the thread's stream
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (message_id, sender, emoji)
);
CREATE INDEX IF NOT EXISTS chat_reactions_thread_seq ON chat_reactions (thread, seq DESC);
CREATE INDEX IF NOT EXISTS chat_reactions_message ON chat_reactions (message_id);

CREATE TABLE IF NOT EXISTS chat_reads (
  thread     TEXT NOT NULL,
  sender     TEXT NOT NULL,      -- per-sender, not per-device: read anywhere = read everywhere
  last_seq   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (thread, sender)
);

CREATE TABLE IF NOT EXISTS chat_push_subs (
  endpoint   TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Attachment metadata (blobs in R2 under chat/). Unused until attachments ship;
-- created now so the schema file is complete.
CREATE TABLE IF NOT EXISTS chat_attachments (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER
);
