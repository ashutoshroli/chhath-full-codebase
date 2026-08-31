# Frontend changes required

## mgmt/frontend

**None.** `api.js` already reads the backend URL from `import.meta.env.VITE_API_URL`
(line 1). Point that env var at the deployed `chhath-mgmt-api` Worker URL instead of
the old Apps Script `/exec` URL — that's the entire frontend change.

Every other non-negotiable that could have forced a frontend change was designed
around instead (see MIGRATION_NOTES.md):
- `__rowIndex` stays the same JSON key, now backed by D1's autoincrement `id`.
- Response shapes from every ported action are unchanged — same keys, same casing
  (`getHome` returns `{ collections, totCol, totExp, ... }` exactly as before, etc).
- `action`-based single-POST-endpoint protocol is preserved (Worker's `index.js`
  dispatches on `req.action` exactly like the old `doPost`'s `handlers` map).

## Public/frontend

**One line changed** — correcting what I said earlier. `script.js` line 11 had the
Apps Script URL **hardcoded as a string literal**, not read from an env var (I said
"also an env var" before — that was wrong; `Public/frontend` has no build step at
all, just plain `index.html`/`script.js`/`style.css`, so there's no env var
mechanism available to it, unlike `mgmt/frontend`'s Vite setup).

I've updated that line in this package to point at a placeholder
`chhath-public-api.YOUR-SUBDOMAIN.workers.dev` URL — **replace it with your real
deployed Worker URL** after running `wrangler deploy` in `Public/backend`.

## What to actually test after deploying

Since no frontend code changes, regression risk is entirely on the Worker side
matching response shapes exactly. Suggest smoke-testing, per view, in this rough
priority order (matches how central each view is):
1. Login → Home → Users → Committee → Collections (core CRUD loop)
2. Announcement Portal (your most recent work — link generate, PIN verify, queue,
   mark-announced, reannounce)
3. Popup management + getActivePopups on login
4. Dropdown lists, Festival dates, Portal settings
5. WhatsApp templates/groups/queue (getPendingMessages/updateMessageStatus — also
   check your Termux automation script still authenticates correctly with apiKey)
6. Everything flagged "NOT YET PORTED" in MIGRATION_NOTES.md won't work at all yet —
   Loans tab, Receipt/Certificate/Samaan/DOCX template screens, Download Center will
   error until those are finished.
