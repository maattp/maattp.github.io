# Split App Backend

Backend for the Split app — a simple two-person expense splitter. Runs on Cloudflare Workers (free plan) with D1 for persistence.

## Architecture

```
Client (iOS PWA)  ──HTTPS──>  Cloudflare Worker  ──SQL──>  D1 (SQLite)
                                    │
                                    └──HTTPS──>  Google tokeninfo (auth only)
```

- **Runtime**: Cloudflare Workers (free plan: 100K requests/day)
- **Database**: Cloudflare D1 (free plan: 5M rows read/day, 100K rows written/day, 5GB storage)
- **Auth**: Google Sign-In verified server-side, backend issues JWTs

## D1 Schema

```sql
-- migrations/0001_init.sql

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user1_id INTEGER NOT NULL REFERENCES users(id),
  user2_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user1_id, user2_id),
  CHECK(user1_id < user2_id)
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE NOT NULL,
  split_id INTEGER NOT NULL REFERENCES splits(id),
  paid_by_user_id INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  payer_percent INTEGER NOT NULL DEFAULT 50 CHECK(payer_percent >= 0 AND payer_percent <= 100),
  created_at TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  deleted_at TEXT DEFAULT NULL
);

CREATE INDEX idx_expenses_split_id ON expenses(split_id);
CREATE INDEX idx_expenses_client_id ON expenses(client_id);
CREATE INDEX idx_splits_user1 ON splits(user1_id);
CREATE INDEX idx_splits_user2 ON splits(user2_id);
```

### Schema Notes

- `splits.user1_id < splits.user2_id` constraint ensures each pair is stored once regardless of who created it.
- `expenses.client_id` is a UUID generated client-side. This is the idempotency key — the UNIQUE constraint prevents duplicate inserts.
- `expenses.payer_percent` is how much of the expense the payer is responsible for. Default 50 = equal split. 0 = payer owes nothing (other person owes full amount). 100 = payer owes everything (effectively no split).
- `expenses.deleted_at` enables soft deletes. Queries filter `WHERE deleted_at IS NULL`.
- `users.google_id` and `users.name` are nullable to support "stub" users created when someone starts a split with a partner who hasn't signed up yet. The stub is matched by email when they sign up.

### Balance Calculation

From the perspective of user A in a split with user B:

```
balance = 0
for each expense where deleted_at IS NULL:
  net_to_other = amount_cents * (100 - payer_percent) / 100
  if paid_by_user_id == A:
    balance += net_to_other   (B owes A)
  else:
    balance -= net_to_other   (A owes B)
```

Positive balance = B owes A. Negative balance = A owes B.

## Authentication

### Flow

1. Frontend loads Google Identity Services (GIS) library
2. User taps "Sign in with Google" → GIS returns an ID token (JWT)
3. Frontend sends the ID token to `POST /api/auth/google`
4. Worker verifies the token by calling `https://oauth2.googleapis.com/tokeninfo?id_token=...`
5. Worker validates `aud` matches our Google Client ID
6. Worker creates or updates the user in D1 (upsert by email, update google_id/name/picture)
7. Worker signs a backend JWT (HS256) with a secret stored in Workers secrets
8. Frontend stores the backend JWT and sends it as `Authorization: Bearer <token>` on all subsequent requests

### Backend JWT

- Algorithm: HS256 (HMAC-SHA256 via Web Crypto API)
- Secret: stored as `JWT_SECRET` in Workers secrets (`wrangler secret put JWT_SECRET`)
- Payload: `{ sub: <user_id>, email: <email>, iat: <timestamp>, exp: <timestamp> }`
- Expiration: 30 days
- The Worker validates the JWT on every authenticated request

### Token Refresh

When the backend JWT expires, API calls return 401. The frontend catches this and shows the login screen. The user signs in with Google again to get a new backend JWT.

## API Endpoints

All endpoints except `/api/auth/google` require `Authorization: Bearer <token>`.

All responses are JSON. Errors use `{ "error": "<message>" }` with appropriate HTTP status codes.

### POST /api/auth/google

Exchange a Google ID token for a backend JWT.

**Request:**
```json
{
  "id_token": "eyJhbGciOiJSUzI1NiIs..."
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@gmail.com",
    "name": "Jane Doe",
    "picture": "https://lh3.googleusercontent.com/..."
  }
}
```

**Logic:**
1. Call `https://oauth2.googleapis.com/tokeninfo?id_token=<token>`
2. Verify `aud` matches `GOOGLE_CLIENT_ID` env var
3. Extract `sub` (Google ID), `email`, `name`, `picture`
4. Upsert user: `INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET google_id=excluded.google_id, name=excluded.name, picture=excluded.picture`
5. Sign and return backend JWT

**Errors:**
- 400: Missing or invalid `id_token`
- 401: Google token verification failed or `aud` mismatch

### GET /api/splits

List the authenticated user's splits with current balances.

**Response (200):**
```json
{
  "splits": [
    {
      "id": 1,
      "partner": {
        "id": 2,
        "email": "partner@gmail.com",
        "name": "John Doe",
        "picture": "https://..."
      },
      "balance_cents": -2350
    }
  ]
}
```

**Logic:**
1. Find all splits where `user1_id = me OR user2_id = me`
2. For each split, calculate balance using the formula above
3. The `partner` is whichever user in the split is not me

**SQL:**
```sql
SELECT s.id, s.user1_id, s.user2_id,
  u1.email as u1_email, u1.name as u1_name, u1.picture as u1_picture,
  u2.email as u2_email, u2.name as u2_name, u2.picture as u2_picture
FROM splits s
JOIN users u1 ON s.user1_id = u1.id
JOIN users u2 ON s.user2_id = u2.id
WHERE s.user1_id = ?1 OR s.user2_id = ?1;

-- For each split, calculate balance (must filter soft deletes):
SELECT paid_by_user_id, amount_cents, payer_percent
FROM expenses
WHERE split_id = ?1
  AND deleted_at IS NULL;
```

### POST /api/splits

Create a new split with a partner.

**Request:**
```json
{
  "partner_email": "partner@gmail.com"
}
```

**Response (201):**
```json
{
  "split": {
    "id": 1,
    "partner": {
      "id": 2,
      "email": "partner@gmail.com",
      "name": "John Doe",
      "picture": null
    }
  }
}
```

**Logic:**
1. Normalize email to lowercase
2. Reject if `partner_email == my email`
3. Look up partner by email. If not found, create a stub user: `INSERT INTO users (email) VALUES (?)`
4. Determine user1_id and user2_id (lower ID first to satisfy CHECK constraint)
5. Insert split. If UNIQUE constraint violated, return the existing split instead
6. Return split with partner info

**Errors:**
- 400: Missing `partner_email` or same as own email
- 409: Split already exists (return existing split)

### GET /api/splits/:id

Get split details including all expenses.

**Response (200):**
```json
{
  "split": {
    "id": 1,
    "partner": {
      "id": 2,
      "email": "partner@gmail.com",
      "name": "John Doe",
      "picture": null
    }
  },
  "expenses": [
    {
      "client_id": "550e8400-e29b-41d4-a716-446655440000",
      "description": "Groceries",
      "amount_cents": 4520,
      "paid_by_user_id": 1,
      "payer_percent": 50,
      "created_at": "2025-01-15T10:30:00Z",
      "created_by_user_id": 1
    }
  ],
  "balance_cents": 2260
}
```

**Logic:**
1. Verify the authenticated user is a member of this split
2. Fetch all non-deleted expenses ordered by `created_at DESC`
3. Calculate balance

**Errors:**
- 403: User is not a member of this split
- 404: Split not found

### POST /api/splits/:id/sync

Sync a batch of operations (adds and deletes). This is the primary sync endpoint. **Idempotent** — safe to retry.

**Request:**
```json
{
  "operations": [
    {
      "action": "add",
      "expense": {
        "client_id": "550e8400-e29b-41d4-a716-446655440000",
        "description": "Groceries",
        "amount_cents": 4520,
        "paid_by_user_id": 1,
        "payer_percent": 50,
        "created_at": "2025-01-15T10:30:00Z"
      }
    },
    {
      "action": "delete",
      "client_id": "660e8400-e29b-41d4-a716-446655440001"
    }
  ]
}
```

**Response (200):**
```json
{
  "results": [
    { "client_id": "550e8400-...", "status": "created" },
    { "client_id": "660e8400-...", "status": "deleted" }
  ],
  "balance_cents": 2260
}
```

**Logic:**
1. Verify user is a member of this split
2. Process each operation in order:
   - **add**: `INSERT INTO expenses (...) VALUES (...) ON CONFLICT(client_id) DO NOTHING`. If inserted → `"created"`. If conflict → `"duplicate"`.
   - **delete**: `UPDATE expenses SET deleted_at = datetime('now') WHERE client_id = ? AND split_id = ? AND deleted_at IS NULL`. If updated → `"deleted"`. If no rows affected → `"not_found"` (already deleted or never existed).
3. Validate each add operation:
   - `paid_by_user_id` must be one of the two users in the split
   - `amount_cents` must be positive
   - `payer_percent` must be 0-100
   - `client_id` must be present
4. `created_by_user_id` is set to the authenticated user (not from the request)
5. Return updated balance

**Idempotency**: The `ON CONFLICT(client_id) DO NOTHING` ensures re-syncing the same expense is a no-op. Deleting an already-deleted expense returns `"not_found"` but doesn't error. The entire operation is safe to retry.

**Errors:**
- 400: Invalid operations format
- 403: User is not a member of this split
- 404: Split not found

### DELETE /api/splits/:id/expenses/:clientId

Delete a single expense. Convenience endpoint (same as sending a delete via sync).

**Response (200):**
```json
{
  "status": "deleted",
  "balance_cents": 1500
}
```

**Errors:**
- 403: User is not a member of this split
- 404: Expense or split not found

## CORS

The Worker must handle CORS for the frontend origin:

```javascript
const ALLOWED_ORIGINS = [
  'https://maattp.github.io',
  'http://localhost:8000',  // local dev
];

// Handle OPTIONS preflight
if (request.method === 'OPTIONS') {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Add to all responses
headers.set('Access-Control-Allow-Origin', origin);
```

## Worker Configuration

### wrangler.toml

```toml
name = "split-api"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "split-db"
database_id = "<your-database-id>"
```

### Environment Variables / Secrets

| Name | Type | Description |
|------|------|-------------|
| `GOOGLE_CLIENT_ID` | Variable | Google OAuth 2.0 Client ID |
| `JWT_SECRET` | Secret | Random string for signing backend JWTs (min 32 chars) |

Set via:
```bash
wrangler secret put JWT_SECRET
# Set GOOGLE_CLIENT_ID in wrangler.toml [vars] section
```

### Deployment

```bash
# Create D1 database
wrangler d1 create split-db

# Run migration
wrangler d1 execute split-db --file=migrations/0001_init.sql

# Deploy
wrangler deploy
```

## Rate Limiting

No explicit rate limiting needed at this scale (few users). Cloudflare's built-in protections apply. If needed later, use `CF-Connecting-IP` header to track per-IP request counts in D1 or a KV namespace.

## Error Handling

All errors return JSON:

```json
{
  "error": "Human-readable message"
}
```

Standard HTTP status codes:
- 400: Bad request (validation failure)
- 401: Not authenticated (missing/expired token)
- 403: Forbidden (not a member of the split)
- 404: Resource not found
- 500: Internal server error

## Security Notes

- Google ID tokens are verified server-side on every auth request
- Backend JWTs are validated on every authenticated request
- Users can only access splits they are members of
- `created_by_user_id` is always set server-side from the JWT, never trusted from client input
- `paid_by_user_id` is validated to be one of the two split members
- All inputs are validated (email format, amount > 0, percent 0-100)
- D1 parameterized queries prevent SQL injection
