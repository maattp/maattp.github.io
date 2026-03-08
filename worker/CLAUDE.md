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

## Deployment

Auto-deploys on push to `main` when files in `worker/` change. See `../.github/workflows/deploy-worker.yml`. Requires `CLOUDFLARE_API_TOKEN` repo secret.
