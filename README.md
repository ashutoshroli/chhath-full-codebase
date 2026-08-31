# Chhath Puja Committee Portal — Cloudflare Migration

Full codebase, reorganized to mirror your original project layout.

```
Public/
  backend/     Cloudflare Worker (chhath-public-api) — read-only, replaces Public's old Apps Script backend
  frontend/    Static site (unchanged except one line — see FRONTEND_DIFF_NOTES.md)

mgmt/
  db/
    schema/    CREATE TABLE statements, one file per D1 database (8 total)
    migration/ INSERT statements with your real migrated data (8 total)
  backend/     Cloudflare Worker (chhath-mgmt-api) — replaces mgmt's old Apps Script backend
  frontend/    React/Vite app (unchanged — see FRONTEND_DIFF_NOTES.md)

MIGRATION_NOTES.md       Full write-up: architecture, what's ported, what isn't, bug fixes made along the way
FRONTEND_DIFF_NOTES.md   Exactly what changed (and didn't) in each frontend
GTM_SETUP.md             Google Tag Manager / GA4 / Microsoft Clarity — what's wired up, what to configure in GTM
WHATSAPP_QUEUE_SETUP.md  What to change in your wa-manager polling script (URL + request format)
```

## Deploy order

1. **D1 databases** — create the 8 databases in your Cloudflare account, then for each:
   ```
   wrangler d1 execute <db-name> --remote --file=./mgmt/db/schema/<db>.sql
   wrangler d1 execute <db-name> --remote --file=./mgmt/db/migration/<db>.sql
   ```
2. **`mgmt/backend`** — fill in `wrangler.toml`'s database/KV IDs, set secrets
   (`wrangler secret put PASSWORD_SALT`, etc. — see the comments in `wrangler.toml`),
   then `wrangler deploy`.
3. **`Public/backend`** — same D1 IDs for the 4 DBs it needs, `wrangler deploy`.
4. **`mgmt/frontend`** — set `VITE_API_URL` to the deployed `chhath-mgmt-api` URL, redeploy as usual.
5. **`Public/frontend`** — edit the `API_URL` placeholder in `script.js` to the deployed `chhath-public-api` URL, redeploy as usual.

Read `MIGRATION_NOTES.md` before deploying — it covers what's fully ported, the one
thing that isn't (`bulkFillHindi`), the docx→pdf conversion caveats, and three real
bugs found and fixed along the way (two inherited from the original Code.js).
