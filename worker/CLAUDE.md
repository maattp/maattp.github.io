# Worker

Cloudflare Worker providing a KV storage API. Built with Hono and deployed via Wrangler.

## Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono
- **Storage:** Cloudflare KV (bound as `KV`)
- **Auth:** Google JWT verification (single-user lockdown)

## API

All `/kv/*` routes require `Authorization: Bearer <google-id-token>`.

- `GET /` — health check
- `GET /kv/:key` — read a value
- `PUT /kv/:key` — write a value (body = raw text)
- `DELETE /kv/:key` — delete a value

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

## D1 Database Migrations

The worker uses Cloudflare D1 (SQLite) for structured data. The database is bound as `DB` and named `photos-db`.

### Adding or Updating a Table

1. Create a new migration file in `worker/migrations/` with the next sequential number:
   ```
   worker/migrations/NNNN_description.sql
   ```
   Example: `0003_add_tags_table.sql`

2. Write standard SQL in the migration file (D1 uses SQLite syntax):
   ```sql
   CREATE TABLE IF NOT EXISTS tags (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL
   );
   ```
   For schema changes to existing tables, use `ALTER TABLE`.

3. Test locally before pushing:
   ```bash
   cd worker
   npx wrangler d1 migrations apply photos-db --local
   ```

4. Commit and push. The GitHub Actions workflow automatically runs `wrangler d1 migrations apply photos-db --remote` before deploying, so migrations are applied in CI on merge to `master`.

### Migration Conventions

- Migrations are applied in order by filename prefix (`0001_`, `0002_`, etc.)
- Wrangler tracks which migrations have already been applied — it won't re-run them
- Use `IF NOT EXISTS` / `IF EXISTS` for safety
- Keep each migration focused on a single change
- The current schema is documented in `worker/schema.sql` — update it when adding migrations

## Deployment

Auto-deploys on push to `master` when files in `worker/` change. See `../.github/workflows/deploy-worker.yml`. The workflow runs D1 migrations before deploying the worker. Requires `CLOUDFLARE_API_TOKEN` repo secret.
