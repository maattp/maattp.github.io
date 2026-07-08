-- 75 Hard couples tracker. All tables prefixed hard_.
-- Apply locally:  wrangler d1 execute photos-db --local --file=schema-hard.sql
-- Apply remote (BEFORE merging the code): wrangler d1 execute photos-db --remote --file=schema-hard.sql

CREATE TABLE IF NOT EXISTS hard_users (
  email TEXT PRIMARY KEY,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  grace_minutes INTEGER NOT NULL DEFAULT 180,
  prefs TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Singleton row (id=1). mode: 'solo' | 'team'. status: 'active' | 'complete'.
CREATE TABLE IF NOT EXISTS hard_challenge (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'solo',
  reward_text TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS hard_participants (
  email TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,            -- original local start date, never changes
  streak_start_date TEXT NOT NULL,     -- local date of current Day 1, moves on reset
  last_finalized_date TEXT,            -- finalization cursor
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS hard_days (
  email TEXT NOT NULL,
  date TEXT NOT NULL,                  -- user-LOCAL 'YYYY-MM-DD'
  diet INTEGER NOT NULL DEFAULT 0,
  reading_done INTEGER NOT NULL DEFAULT 0,
  pages INTEGER,
  book_id TEXT,
  workout1_done INTEGER NOT NULL DEFAULT 0,
  workout1_min INTEGER NOT NULL DEFAULT 0,
  workout1_outdoor INTEGER NOT NULL DEFAULT 0,
  workout2_done INTEGER NOT NULL DEFAULT 0,
  workout2_min INTEGER NOT NULL DEFAULT 0,
  workout2_outdoor INTEGER NOT NULL DEFAULT 0,
  water_oz INTEGER NOT NULL DEFAULT 0,
  photo_id TEXT,
  finalized INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  day_number INTEGER,                  -- audit snapshot written at finalization
  updated_at TEXT,
  PRIMARY KEY (email, date)
);

CREATE TABLE IF NOT EXISTS hard_books (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  started_date TEXT,
  finished_date TEXT
);

-- Daily photos. Separate from the photos app's table: different sharing semantics.
CREATE TABLE IF NOT EXISTS hard_photos (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  date TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  content_type TEXT,
  size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hard_photos_email_date ON hard_photos(email, date);

-- Scale measurements: one row per user-local day, re-weighing updates it.
-- Stored in kg (canonical); the client converts per its unit preference.
-- Private by default — the partner sees them only when prefs.shareMeasurements.
CREATE TABLE IF NOT EXISTS hard_measurements (
  email TEXT NOT NULL,
  date TEXT NOT NULL,                  -- user-LOCAL 'YYYY-MM-DD'
  weight_kg REAL,
  fat_pct REAL,
  updated_at TEXT,
  PRIMARY KEY (email, date)
);

-- Activity feed. type: task_done|day_complete|reset|milestone|poke|reaction|
-- photo_shared|challenge_complete|late_action
CREATE TABLE IF NOT EXISTS hard_events (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hard_events_created ON hard_events(created_at);

-- Idempotency ledger: replayed actions return their original result. Pruned >30d.
CREATE TABLE IF NOT EXISTS hard_actions (
  action_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  type TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Endpoint PK = re-subscribing the same endpoint is a natural upsert.
CREATE TABLE IF NOT EXISTS hard_push_subs (
  endpoint TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  ua TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cron dedupe: INSERT OR IGNORE + PK = a reminder fires exactly once per local day.
CREATE TABLE IF NOT EXISTS hard_notif_log (
  email TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'reminder:08:00' | 'bedtime'
  marker TEXT NOT NULL,                -- the local date it belongs to
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, kind, marker)
);
