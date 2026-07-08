# 75 Hard — headless browser drills

End-to-end drills that run the real app in headless Chrome against a local
worker, via CDP. These are the checks behind the PR verification notes; they
are not run in CI (they need Chrome + wrangler dev) but are fully repeatable.

## Prerequisites (three terminals or backgrounded)

```bash
# 1. local worker with local D1/KV/R2 state
cd worker
npx wrangler d1 execute photos-db --local --file=schema-hard.sql
npx wrangler kv key put --binding KV "__session:test-matt" "m.polkiewicz@gmail.com" --local
npx wrangler kv key put --binding KV "__session:test-ting" "ting520143@gmail.com" --local
npx wrangler dev --test-scheduled --port 8787

# 2. static site
python3 -m http.server 8000   # from the repo root
```

Chrome is auto-launched headless on port 9333 (override with `CHROME_BIN`,
`HARD75_CDP_PORT`). Screenshots land in `$TMPDIR/hard75-drills`
(override `HARD75_TEST_OUT`).

## Drills

```bash
node apps/75hard/test/drill-app.mjs           # boot, optimistic dispatch, offline queue + reboot, rollover→reset, screens
node apps/75hard/test/drill-onboarding.mjs    # wizard end-to-end (wipes local hard_* first — see header)
node apps/75hard/test/drill-photo.mjs         # camera file → compositor → upload → R2 round-trip
node apps/75hard/test/drill-measurements.mjs  # scale entry, unit conversion, trend charts, partner privacy
```

Each drill prints a JSON report and exits non-zero on failure or any page
exception. They mutate the LOCAL `.wrangler` D1 state; wipe the `hard_*`
tables between runs for deterministic results:

```bash
cd worker && npx wrangler d1 execute photos-db --local --command \
  "DELETE FROM hard_users; DELETE FROM hard_participants; DELETE FROM hard_challenge; \
   DELETE FROM hard_days; DELETE FROM hard_events; DELETE FROM hard_actions; \
   DELETE FROM hard_photos; DELETE FROM hard_books; DELETE FROM hard_push_subs; \
   DELETE FROM hard_notif_log; DELETE FROM hard_measurements;"
```

Related automated suites (no browser needed, these DO run in CI):
- `worker/test/hard.test.mjs` — pure day-boundary/finalize engine
- `worker/test/hard-mirror.test.mjs` — client↔server logic drift guard
- `worker/test/push.test.mjs` — Web Push VAPID + aes128gcm round-trip
- `worker/test/hard.integration.mjs` — HTTP drills against wrangler dev (manual, needs the server above)
