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

## Prerequisites

### 1. Cloudflare Account & Wrangler CLI

```bash
# Install wrangler globally
npm install -g wrangler

# Authenticate with your Cloudflare account (opens browser)
wrangler login
```

You need a free Cloudflare account at https://dash.cloudflare.com/sign-up.

### 2. Google Cloud OAuth Credentials

Set up Google Sign-In so users can authenticate:

1. Go to https://console.cloud.google.com/ and create a new project (or use an existing one).
2. Navigate to **APIs & Services → OAuth consent screen**.
   - Choose **External** user type.
   - Set the app name (e.g., "Split").
   - Add **Authorized domains**: `maattp.github.io`.
   - Fill in required fields (support email, developer contact email). Leave everything else default.
   - Click **Save and Continue** through the Scopes and Test users steps (no changes needed).
   - On the Summary page, click **Back to Dashboard**.
   - If the app is in **Testing** status, click **Publish App** to allow any Google account to sign in (not just test users). For personal use with a small number of users, this is fine and does not require Google verification.
3. Navigate to **APIs & Services → Credentials**.
   - Click **Create Credentials → OAuth 2.0 Client ID**.
   - Application type: **Web application**.
   - Name: `Split Web Client` (or whatever you like).
   - **Authorized JavaScript origins** — add both:
     - `https://maattp.github.io`
     - `http://localhost:8000` (for local development)
   - Leave **Authorized redirect URIs** empty (not needed for Google Identity Services / One Tap).
   - Click **Create**.
4. Copy the **Client ID** (looks like `123456789-abcdef.apps.googleusercontent.com`). You will need this for both the Worker config and the frontend.

## Worker Project Structure

The backend lives in its own repo (separate from the frontend GitHub Pages site). The repo has this structure:

```
split-worker/               ← standalone repo
├── .github/
│   └── workflows/
│       └── deploy.yml       ← auto-deploy on merge to main
├── wrangler.toml
├── migrations/
│   └── 0001_init.sql
└── src/
    └── index.js
```

Initialize the project:

```bash
mkdir split-worker && cd split-worker
git init
mkdir -p src migrations .github/workflows
```

## D1 Schema

Create the file `migrations/0001_init.sql`:

```sql
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

1. Frontend loads Google Identity Services (GIS) library from `https://accounts.google.com/gsi/client`
2. Frontend initializes GIS with the Google Client ID and renders the Sign-In button
3. User taps "Sign in with Google" → GIS returns an ID token (a Google-signed JWT)
4. Frontend sends the ID token to `POST /api/auth/google`
5. Worker verifies the token by calling `https://oauth2.googleapis.com/tokeninfo?id_token=...`
6. Worker validates the `aud` field in the response matches our Google Client ID
7. Worker creates or updates the user in D1 (upsert by email, update google_id/name/picture)
8. Worker signs a backend JWT (HS256) with a secret stored in Workers secrets
9. Frontend stores the backend JWT and sends it as `Authorization: Bearer <token>` on all subsequent requests

### Backend JWT

- Algorithm: HS256 (HMAC-SHA256 via Web Crypto API)
- Secret: stored as `JWT_SECRET` in Workers secrets
- Payload: `{ sub: <user_id>, email: <email>, iat: <timestamp>, exp: <timestamp> }`
- Expiration: 30 days
- The Worker validates the JWT on every authenticated request

#### JWT Implementation with Web Crypto API

Cloudflare Workers don't have access to Node.js libraries like `jsonwebtoken`. Use the Web Crypto API directly. Here's the pattern:

```javascript
// === JWT Helpers ===

function base64url(buf) {
  // buf can be ArrayBuffer or Uint8Array
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const key = await importKey(secret);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = base64urlDecode(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(signingInput));
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
```

Usage in the auth endpoint:

```javascript
// Sign (after successful Google token verification)
const now = Math.floor(Date.now() / 1000);
const token = await signJWT(
  { sub: user.id, email: user.email, iat: now, exp: now + 30 * 24 * 60 * 60 },
  env.JWT_SECRET
);

// Verify (middleware for authenticated endpoints)
const authHeader = request.headers.get('Authorization');
if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'Missing token' }, 401);
const payload = await verifyJWT(authHeader.slice(7), env.JWT_SECRET);
if (!payload) return jsonResponse({ error: 'Invalid or expired token' }, 401);
// payload.sub is the user ID, payload.email is the email
```

### Token Refresh

When the backend JWT expires, API calls return 401. The frontend catches this, clears the stored auth, and shows the login screen. The user signs in with Google again to get a new backend JWT. No refresh token mechanism is needed.

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
1. Parse JSON body and extract `id_token`. Return 400 if missing.
2. Call `https://oauth2.googleapis.com/tokeninfo?id_token=<token>` via `fetch()`.
3. If the response is not 200, return 401 (token invalid/expired).
4. Parse the JSON response. Verify `aud` matches `env.GOOGLE_CLIENT_ID`. Return 401 if mismatch.
5. Extract `sub` (Google user ID), `email`, `name`, `picture` from the tokeninfo response.
6. Upsert user:
   ```sql
   INSERT INTO users (google_id, email, name, picture)
   VALUES (?1, ?2, ?3, ?4)
   ON CONFLICT(email) DO UPDATE SET
     google_id = excluded.google_id,
     name = excluded.name,
     picture = excluded.picture
   ```
7. Fetch the user row to get the `id`:
   ```sql
   SELECT id, email, name, picture FROM users WHERE email = ?1
   ```
8. Sign and return a backend JWT with `{ sub: user.id, email: user.email }`.

**Errors:**
- 400: Missing or empty `id_token` in request body
- 401: Google tokeninfo returned non-200, or `aud` does not match `GOOGLE_CLIENT_ID`

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
1. Get user ID from JWT payload (`sub`).
2. Query all splits this user is in, joining user info for both members:
   ```sql
   SELECT s.id, s.user1_id, s.user2_id,
     u1.id as u1_id, u1.email as u1_email, u1.name as u1_name, u1.picture as u1_picture,
     u2.id as u2_id, u2.email as u2_email, u2.name as u2_name, u2.picture as u2_picture
   FROM splits s
   JOIN users u1 ON s.user1_id = u1.id
   JOIN users u2 ON s.user2_id = u2.id
   WHERE s.user1_id = ?1 OR s.user2_id = ?1
   ```
3. For each split, fetch expenses and calculate balance:
   ```sql
   SELECT paid_by_user_id, amount_cents, payer_percent
   FROM expenses
   WHERE split_id = ?1 AND deleted_at IS NULL
   ```
4. Calculate balance from the authenticated user's perspective (see Balance Calculation section).
5. Return the `partner` as whichever user in the split is NOT the authenticated user.

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
1. Parse `partner_email` from body. Return 400 if missing.
2. Normalize to lowercase: `partner_email = partner_email.trim().toLowerCase()`.
3. Reject if `partner_email === authenticated user's email`. Return 400.
4. Look up partner by email:
   ```sql
   SELECT id, email, name, picture FROM users WHERE email = ?1
   ```
5. If not found, create a stub user (no google_id, no name):
   ```sql
   INSERT INTO users (email) VALUES (?1)
   ```
   Then fetch the inserted row to get the ID.
6. Determine `user1_id = Math.min(myId, partnerId)` and `user2_id = Math.max(myId, partnerId)` (to satisfy the `CHECK(user1_id < user2_id)` constraint).
7. Insert the split:
   ```sql
   INSERT INTO splits (user1_id, user2_id) VALUES (?1, ?2)
   ```
8. If the INSERT fails due to UNIQUE constraint violation, the split already exists. Query for it:
   ```sql
   SELECT id FROM splits WHERE user1_id = ?1 AND user2_id = ?2
   ```
   Return the existing split with status 409.
9. Return the new split with partner info and status 201.

**Errors:**
- 400: Missing `partner_email` or same as own email
- 409: Split already exists (return the existing split in the response body so the frontend can use it)

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
1. Parse split ID from the URL path (e.g., `/api/splits/5` → `id = 5`).
2. Fetch the split with both user info:
   ```sql
   SELECT s.id, s.user1_id, s.user2_id,
     u1.id as u1_id, u1.email as u1_email, u1.name as u1_name, u1.picture as u1_picture,
     u2.id as u2_id, u2.email as u2_email, u2.name as u2_name, u2.picture as u2_picture
   FROM splits s
   JOIN users u1 ON s.user1_id = u1.id
   JOIN users u2 ON s.user2_id = u2.id
   WHERE s.id = ?1
   ```
3. Return 404 if not found.
4. Verify the authenticated user is `user1_id` or `user2_id`. Return 403 if not.
5. Fetch all non-deleted expenses ordered by `created_at DESC`:
   ```sql
   SELECT client_id, description, amount_cents, paid_by_user_id, payer_percent, created_at, created_by_user_id
   FROM expenses
   WHERE split_id = ?1 AND deleted_at IS NULL
   ORDER BY created_at DESC
   ```
6. Calculate balance from the authenticated user's perspective.
7. Return split (with partner info), expenses, and balance.

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
1. Parse split ID from URL. Fetch the split. Return 404 if not found.
2. Verify user is a member of this split. Return 403 if not.
3. Parse `operations` array from body. Return 400 if missing or not an array.
4. Use `env.DB.batch()` to process all operations atomically. Build an array of D1 prepared statements, then execute them in one batch call. This ensures either all operations succeed or none do.
5. Process each operation:
   - **add**: Validate the expense fields first:
     - `expense.client_id` must be a non-empty string
     - `expense.amount_cents` must be a positive integer
     - `expense.payer_percent` must be an integer 0-100
     - `expense.paid_by_user_id` must be one of the two users in the split (`user1_id` or `user2_id`)
     - `expense.description` must be a non-empty string
     - `expense.created_at` must be a non-empty string
     - Return 400 with a descriptive error if any validation fails
     Then insert:
     ```sql
     INSERT INTO expenses (client_id, split_id, paid_by_user_id, description, amount_cents, payer_percent, created_at, created_by_user_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(client_id) DO NOTHING
     ```
     Set `created_by_user_id` to the authenticated user's ID (from JWT, NOT from the request).
     Check `meta.changes` on the D1 result: if 1 → status `"created"`, if 0 → status `"duplicate"`.
   - **delete**:
     ```sql
     UPDATE expenses SET deleted_at = datetime('now')
     WHERE client_id = ?1 AND split_id = ?2 AND deleted_at IS NULL
     ```
     Check `meta.changes`: if 1 → status `"deleted"`, if 0 → status `"not_found"`.
6. After all operations, recalculate balance and return it.

**Idempotency**: The `ON CONFLICT(client_id) DO NOTHING` ensures re-syncing the same expense is a no-op. Deleting an already-deleted expense returns `"not_found"` but doesn't error. The entire operation is safe to retry.

**Errors:**
- 400: Invalid operations format or validation failure on an expense
- 403: User is not a member of this split
- 404: Split not found

### DELETE /api/splits/:id/expenses/:clientId

Delete a single expense. Convenience endpoint (same as sending a delete via sync).

**Logic:**
1. Parse split ID and client ID from the URL path.
2. Fetch the split. Return 404 if not found.
3. Verify user is a member. Return 403 if not.
4. Soft-delete the expense:
   ```sql
   UPDATE expenses SET deleted_at = datetime('now')
   WHERE client_id = ?1 AND split_id = ?2 AND deleted_at IS NULL
   ```
5. Return 404 if no rows were affected (expense not found or already deleted).
6. Recalculate and return balance.

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

The Worker must handle CORS for the frontend origin. **Important**: Only reflect the `Origin` header back if it's in the allow-list. Never use `*` because the frontend sends `Authorization` headers.

```javascript
const ALLOWED_ORIGINS = [
  'https://maattp.github.io',
  'http://localhost:8000',  // local dev
];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// At the top of the fetch handler, before routing:
if (request.method === 'OPTIONS') {
  return new Response(null, { status: 204, headers: getCorsHeaders(request) });
}

// Wrap all responses to include CORS headers:
function jsonResponse(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(request),
    },
  });
}
```

## Worker Configuration

### wrangler.toml

```toml
name = "split-api"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com"

[[d1_databases]]
binding = "DB"
database_name = "split-db"
database_id = "<filled-in-after-d1-create>"
```

The `GOOGLE_CLIENT_ID` goes in `[vars]` because it's not a secret — it's also embedded in the frontend HTML. The `database_id` is printed when you run `wrangler d1 create` (see Deployment section).

### Environment Variables / Secrets

| Name | Type | Where | Description |
|------|------|-------|-------------|
| `GOOGLE_CLIENT_ID` | Variable | `wrangler.toml` `[vars]` | Google OAuth 2.0 Client ID from Cloud Console |
| `JWT_SECRET` | Secret | `wrangler secret put` | Random string for signing backend JWTs |
| `DB` | D1 Binding | `wrangler.toml` `[[d1_databases]]` | D1 database binding (automatic) |

**Generate and set JWT_SECRET:**

```bash
# Generate a secure random secret (64 chars, base64-encoded)
openssl rand -base64 48

# Set it as a Workers secret (paste the output when prompted)
wrangler secret put JWT_SECRET
```

Never put `JWT_SECRET` in `wrangler.toml` or commit it to git. It exists only in Cloudflare's encrypted secret storage. You access it in code via `env.JWT_SECRET`.

### Worker Entry Point

The Worker is a single `src/index.js` file using the ES modules format:

```javascript
export default {
  async fetch(request, env, ctx) {
    // env.DB       → D1 database
    // env.JWT_SECRET     → secret string
    // env.GOOGLE_CLIENT_ID → Google OAuth client ID

    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    // Route requests
    // POST /api/auth/google     → handleAuth(request, env)
    // GET  /api/splits          → handleGetSplits(request, env, userId)
    // POST /api/splits          → handleCreateSplit(request, env, userId)
    // GET  /api/splits/:id      → handleGetSplit(request, env, userId, splitId)
    // POST /api/splits/:id/sync → handleSync(request, env, userId, splitId)
    // DELETE /api/splits/:id/expenses/:clientId → handleDeleteExpense(...)

    // All routes except /api/auth/google need JWT verification:
    // const payload = await verifyJWT(token, env.JWT_SECRET);
    // userId = payload.sub;
  }
};
```

Use `url.pathname` and string matching or a simple regex to route requests. No framework needed. Parse path parameters like split IDs by splitting the path:

```javascript
// Example routing pattern:
const match = path.match(/^\/api\/splits\/(\d+)\/sync$/);
if (match && request.method === 'POST') {
  const splitId = parseInt(match[1]);
  return handleSync(request, env, userId, splitId);
}

const expenseMatch = path.match(/^\/api\/splits\/(\d+)\/expenses\/(.+)$/);
if (expenseMatch && request.method === 'DELETE') {
  const splitId = parseInt(expenseMatch[1]);
  const clientId = decodeURIComponent(expenseMatch[2]);
  return handleDeleteExpense(request, env, userId, splitId, clientId);
}
```

## Deployment

### First-Time Setup

Run these commands from the `split-worker/` repo root:

```bash
# 1. Create the D1 database
wrangler d1 create split-db
# Output will include: database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
# Copy that ID into wrangler.toml under [[d1_databases]] database_id

# 2. Run the migration to create tables
wrangler d1 execute split-db --remote --file=migrations/0001_init.sql

# 3. Set the JWT secret
openssl rand -base64 48
wrangler secret put JWT_SECRET
# Paste the generated secret when prompted

# 4. Deploy the Worker (first time only — CI handles subsequent deploys)
wrangler deploy
# Output: https://split-api.<your-subdomain>.workers.dev
```

After `wrangler deploy`, you'll see the Worker URL. It will be `https://split-api.<your-subdomain>.workers.dev`. This is your `API_URL`.

### CI/CD — Auto-Deploy on Merge

The backend repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that auto-deploys the Worker whenever code is pushed to `main`. Merging a PR triggers a deploy automatically.

Create `.github/workflows/deploy.yml` in the backend repo:

```yaml
name: Deploy Split Worker

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy to Cloudflare Workers
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

**GitHub Secrets to configure** (in the backend repo → Settings → Secrets and variables → Actions):

| Secret | How to get it |
|--------|---------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → Use the **"Edit Cloudflare Workers"** template → (optionally scope to your account/zone) → Create Token. Copy the token value. |

The `wrangler-action` also needs your Cloudflare Account ID. **Recommended**: Add `account_id` to `wrangler.toml` so the workflow doesn't need it as a separate secret:

```toml
name = "split-api"
main = "src/index.js"
compatibility_date = "2024-01-01"
account_id = "YOUR_ACCOUNT_ID_HERE"

[vars]
GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com"

[[d1_databases]]
binding = "DB"
database_name = "split-db"
database_id = "<filled-in-after-d1-create>"
```

To find your Account ID: Cloudflare dashboard → pick any domain (or Workers & Pages) → the Account ID is shown in the right sidebar. This is not a secret — it's safe to commit.

**What the workflow does:**
1. Triggers on any push to `main`
2. Checks out the repo
3. Runs `wrangler deploy` using `cloudflare/wrangler-action@v3`

**D1 migrations** are NOT auto-run by this workflow. If you add a new migration file, run it manually before/after deploy:
```bash
wrangler d1 execute split-db --remote --file=migrations/0002_whatever.sql
```

## Connecting the Frontend

After deploying, update the frontend config in `/apps/split/index.html`:

```javascript
const CONFIG = {
    MOCK_MODE: false,  // ← Change from true to false
    GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com',  // ← From Google Cloud Console
    API_URL: 'https://split-api.YOUR_SUBDOMAIN.workers.dev',  // ← From wrangler deploy output
    SYNC_INTERVAL: 30000,
};
```

Both `GOOGLE_CLIENT_ID` values (in `wrangler.toml` and in `index.html`) must be the same Client ID from Google Cloud Console.

## Local Development

### Testing the Worker Locally

```bash
cd split-worker

# Start the Worker in local dev mode (uses a local D1 SQLite file)
wrangler dev

# The first time, run the migration against the local D1:
wrangler d1 execute split-db --local --file=migrations/0001_init.sql
```

`wrangler dev` starts a local server at `http://localhost:8787`. The local D1 database is stored in `.wrangler/state/` within the project directory.

### Testing the Frontend Locally

In a separate terminal:

```bash
cd /path/to/maattp.github.io
python3 -m http.server 8000
```

For local testing, temporarily update the frontend config:

```javascript
const CONFIG = {
    MOCK_MODE: false,
    GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com',
    API_URL: 'http://localhost:8787',  // ← local worker
    SYNC_INTERVAL: 30000,
};
```

Google Sign-In will work on `http://localhost:8000` because we added it to the Authorized JavaScript origins in the Google Cloud Console.

### Testing with curl

```bash
WORKER_URL="http://localhost:8787"  # or your deployed URL

# Test auth (you need a real Google ID token for this —
# easiest to grab one from the browser's Network tab after signing in)
curl -X POST "$WORKER_URL/api/auth/google" \
  -H "Content-Type: application/json" \
  -d '{"id_token": "PASTE_GOOGLE_ID_TOKEN_HERE"}'

# Use the returned backend JWT for subsequent requests:
TOKEN="eyJhbGciOiJIUzI1NiIs..."

# List splits
curl "$WORKER_URL/api/splits" -H "Authorization: Bearer $TOKEN"

# Create a split
curl -X POST "$WORKER_URL/api/splits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"partner_email": "partner@gmail.com"}'

# Get split detail
curl "$WORKER_URL/api/splits/1" -H "Authorization: Bearer $TOKEN"

# Sync an expense
curl -X POST "$WORKER_URL/api/splits/1/sync" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"operations": [{"action": "add", "expense": {"client_id": "test-uuid-1", "description": "Test", "amount_cents": 1000, "paid_by_user_id": 1, "payer_percent": 50, "created_at": "2025-01-15T10:30:00Z"}}]}'

# Delete an expense
curl -X DELETE "$WORKER_URL/api/splits/1/expenses/test-uuid-1" \
  -H "Authorization: Bearer $TOKEN"
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

Wrap the entire fetch handler in a try/catch to ensure unhandled exceptions return a 500 JSON response instead of a bare error page:

```javascript
try {
  // ... all routing and logic
} catch (err) {
  console.error(err);
  return jsonResponse({ error: 'Internal server error' }, 500, request);
}
```

## Security Notes

- Google ID tokens are verified server-side on every auth request via Google's tokeninfo endpoint
- Backend JWTs are validated on every authenticated request (signature + expiration)
- `JWT_SECRET` is stored as a Cloudflare Workers secret (encrypted at rest), never in `wrangler.toml` or source code
- Users can only access splits they are members of (checked on every split-related endpoint)
- `created_by_user_id` is always set server-side from the JWT, never trusted from client input
- `paid_by_user_id` is validated to be one of the two split members
- All inputs are validated (email format, amount > 0, percent 0-100)
- D1 parameterized queries prevent SQL injection
- CORS is restricted to specific allowed origins (not `*`)
