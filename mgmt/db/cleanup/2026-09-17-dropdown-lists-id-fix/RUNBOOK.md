# Fix `dropdown_lists.id` on live D1 — runbook

Restores the live `dropdown_lists` table (`chhath-core`) so its `id` column is
`INTEGER PRIMARY KEY AUTOINCREMENT` again, matching `mgmt/db/schema/core.sql`,
preserving every existing row. Copy-paste each step in order, from the repo root.

**This rebuilds a live table. Do step 0 first.**

## Why

Adding a new item in **List management** silently lost data on live: the row
looked saved but was gone after reload. The live `dropdown_lists.id` had lost its
`INTEGER PRIMARY KEY AUTOINCREMENT` and become a plain `id INTEGER` (introduced by
the reset RUNBOOK's "If something goes wrong" restore path, which replays a
`wrangler d1 export` that re-emits the table with a plain `id`). With a plain `id`
an INSERT that omits `id` reports `changes = 1` while storing `id = NULL`, so the
`meta.changes` guard added in FEAT-002 cannot catch it. See the full root-cause
note in `fix-dropdown-lists-id.sql`.

The worker code fix (FEAT-002) and this SQL are independent; both together fully
resolve the bug. See step 5.

---

## Step 0 — back up

```bash
npx wrangler d1 export chhath-core --remote --output backup-core-$(date +%F).sql
```

Confirm the file is non-empty before continuing.

## Step 1 — PRE-FLIGHT detection (read-only)

Print the live table definition:

```bash
npx wrangler d1 execute chhath-core --remote --command \
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='dropdown_lists';"
```

**Only proceed if the printed `CREATE TABLE` shows a plain `id INTEGER` WITHOUT
`PRIMARY KEY`** (i.e. it does NOT read `id INTEGER PRIMARY KEY AUTOINCREMENT`).
If `id` already has `PRIMARY KEY`, the table is correct — **STOP**, do not run the
fix; the remaining bug (if any) is code-only and is handled by the FEAT-002
deploy in step 5.

Also record the current row count so you can confirm it afterwards:

```bash
npx wrangler d1 execute chhath-core --remote --command \
  "SELECT COUNT(*) AS rows FROM dropdown_lists;"
```

## Step 2 — apply the fix

```bash
npx wrangler d1 execute chhath-core --remote --file \
  mgmt/db/cleanup/2026-09-17-dropdown-lists-id-fix/fix-dropdown-lists-id.sql
```

The script wraps its statements in an explicit `BEGIN TRANSACTION;` ... `COMMIT;`,
so the whole rebuild lands or none of it does — a mid-script failure after
`DROP TABLE` rolls back and can never leave `dropdown_lists` gone, independent of
how `wrangler d1 execute` batches statements.

## Step 3 — post-check

Re-run the detection query and confirm the shape is now correct:

```bash
npx wrangler d1 execute chhath-core --remote --command \
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='dropdown_lists';"
```

The printed `CREATE TABLE` must now contain `id INTEGER PRIMARY KEY AUTOINCREMENT`.

Confirm no rows were lost — this count must match the pre-count from step 1:

```bash
npx wrangler d1 execute chhath-core --remote --command \
  "SELECT COUNT(*) AS rows FROM dropdown_lists;"
```

## Step 4 — verify ADD works in the UI

Log in to the management portal, open **List management**, add a throwaway
Category item, reload the page, and confirm it is still there. Then delete that
throwaway item. Add / Edit / Delete should all persist across a reload now.

## Step 5 — deploy the worker code fix (separate, does not depend on this SQL)

The management worker fix from FEAT-002 (hardened `dropdownLists.js`) deploys
independently of this SQL:

```bash
cd mgmt/backend
git pull
npx wrangler deploy
```

This SQL fixes the live table shape; the deploy makes the code surface any future
0-change writes as a visible error instead of a silent success. Apply both to
fully resolve the bug.

---

## Restore the QA-edited row id=1 (`Lighting`)

During live QA the Category row `id=1` was changed from `Lighting` / `रोशनी` to
`Lighting QA5476` / `लाइटिंग`. Revert it with:

```bash
npx wrangler d1 execute chhath-core --remote --command \
  "UPDATE dropdown_lists SET english_value='Lighting', hindi_label='रोशनी' WHERE id=1 AND list_type='Category';"
```

Run it AFTER the id-fix, or independently — it works regardless of the table
shape. Alternatively, fix the same row through the now-working **Edit** UI in
List management.
