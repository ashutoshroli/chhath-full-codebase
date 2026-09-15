# Reset portal data — runbook

Clears all testing data from the live portal. Keeps **`USER0001`** as the only
member and the only login. Copy-paste each step in order, from the repo root.

**This deletes production data permanently. Do step 0 first.**

## What survives

| | |
| --- | --- |
| `users` | one row, `id_code = 'USER0001'`, renumbered to `id 1` |
| `login_users` | one row, `name = 'USER0001'` |
| **Configuration, untouched** | all 7 document-template tables (`receipt_templates`, `certificate_templates`, `samaan_templates`, `docx_templates`, `pdf_templates`, `consent_page_templates`, `doc_pdf_templates`) · `dropdown_lists` · `portal_settings` · `journey_entries` · `ai_providers` · `whatsapp_groups` · `person_message_templates` · `group_message_templates` · `email_message_templates` · `loan_message_templates` · `loan_email_templates` |
| `official_emails` | kept on request — real correspondence, not test data |

Emptying any of those configuration tables would break the portal rather than
clean it: no templates means no PDF can be generated, no `dropdown_lists` means
volunteers cannot pick a payment mode or category, and `ai_providers` holds the
encrypted API keys.

## What is cleared

23 tables, plus 2 optional:

| Database | Emptied |
| --- | --- |
| `chhath-core` | `committee_members` · `push_subscriptions` · `manual_years` · `locked_years` · `festival_dates` |
| `chhath-collections` | `collections` |
| `chhath-loans-expenses` | `loans` · `expenses` · `loan_guarantors` · `loan_consents` |
| `chhath-file-index` | `generated_files` |
| `chhath-whatsapp-index` | `person_messages` · `group_messages` · `email_messages` |
| `chhath-logs` | `activity_log` · `error_log` · `ai_fixes` |
| `chhath-misc` | `announcement_links` · `custom_announcements` · `collection_jobs` · `render_jobs` |
| `chhath-audit` | `user_sessions` · `login_attempts` |
| `chhath-misc` *(optional, `07b`)* | `popups` · `popup_slides` |

Every `id` sequence is reset, so the next row in each emptied table starts at 1
and the next member becomes `USER0002`.

---

## Step 0 — back up

> **Use the CLI loop below, not the Superadmin → Backup & Restore download.**
> The UI backup is currently PARTIAL: it covers 8 of the 9 databases and skips
> `user_sessions`, `login_attempts`, `journey_entries`, `push_subscriptions`,
> `loan_email_templates`, `email_message_templates`, `email_messages`,
> `official_emails`, `ai_fixes`, `ai_providers`, `collection_jobs` and
> `render_jobs`. Anything it does not export cannot be restored from it.
> Also copy the R2 bucket / Drive folder — deleted files are not recoverable from
> a database backup.

The complete export:

```bash
for db in chhath-core chhath-collections chhath-loans-expenses chhath-file-index \
          chhath-whatsapp-index chhath-logs chhath-misc chhath-audit chhath-templates; do
  npx wrangler d1 export "$db" --remote --output "backup-$db-$(date +%F).sql"
done
```

Confirm the files are non-empty before continuing.

> Want a dry run first? Every command below works against the local D1 copy if you
> drop `--remote`. Nothing in this runbook is specific to remote.

## Step 1 — confirm the identity, and that you will not lock yourself out

**Do not skip this.** After step 4 there is exactly one login left. If that row is
not a `Superadmin`, nobody can administer the portal and nobody is left who could
promote it — recovering needs direct database surgery.

```bash
npx wrangler d1 execute chhath-core --remote --command \
  "SELECT id, id_code, name, mobile, email FROM users WHERE TRIM(COALESCE(id_code,'')) = 'USER0001'"
```

```bash
npx wrangler d1 execute chhath-core --remote --command \
  "SELECT id, name, role, email, mobile, totp_enabled FROM login_users ORDER BY id"
```

Check all four:

1. The `users` query returns **exactly one** row. If it returns none, stop — the
   SQL will delete nothing (it fails safe) but nothing will be cleaned either.
   If it returns more than one, `01-core.sql` keeps the lowest `id`; make sure
   that is the row you want.
2. A `login_users` row has `name` = **`USER0001`**. If the account you want to
   keep has a different `name`, edit that one literal in `01-core.sql` before
   running it (two places, both flagged in comments).
3. That row's `role` is **`Superadmin`**. If it is not, fix it now:
   ```bash
   npx wrangler d1 execute chhath-core --remote --command \
     "UPDATE login_users SET role = 'Superadmin' WHERE name = 'USER0001'"
   ```
4. If that row has `totp_enabled = 1`, **log in with the authenticator now** and
   confirm the code works. A stale 2FA secret plus no other login is a lockout.

## Step 2 — see what will be removed

```bash
npx wrangler d1 execute chhath-core --remote --command \
  "SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM login_users) logins, (SELECT COUNT(*) FROM committee_members) committee, (SELECT COUNT(*) FROM push_subscriptions) push, (SELECT COUNT(*) FROM manual_years) manual_years, (SELECT COUNT(*) FROM locked_years) locked_years, (SELECT COUNT(*) FROM festival_dates) festival_dates"
npx wrangler d1 execute chhath-collections --remote --command \
  "SELECT COUNT(*) collections FROM collections"
npx wrangler d1 execute chhath-loans-expenses --remote --command \
  "SELECT (SELECT COUNT(*) FROM loans) loans, (SELECT COUNT(*) FROM expenses) expenses, (SELECT COUNT(*) FROM loan_guarantors) guarantors, (SELECT COUNT(*) FROM loan_consents) consents"
npx wrangler d1 execute chhath-file-index --remote --command \
  "SELECT COUNT(*) generated_files FROM generated_files"
npx wrangler d1 execute chhath-whatsapp-index --remote --command \
  "SELECT (SELECT COUNT(*) FROM person_messages) person, (SELECT COUNT(*) FROM group_messages) grp, (SELECT COUNT(*) FROM email_messages) mail, (SELECT COUNT(*) FROM official_emails) official_KEPT"
npx wrangler d1 execute chhath-logs --remote --command \
  "SELECT (SELECT COUNT(*) FROM error_log) errors, (SELECT COUNT(*) FROM activity_log) activity, (SELECT COUNT(*) FROM ai_fixes) ai_fixes, (SELECT COUNT(*) FROM ai_providers) providers_KEPT"
npx wrangler d1 execute chhath-misc --remote --command \
  "SELECT (SELECT COUNT(*) FROM announcement_links) links, (SELECT COUNT(*) FROM custom_announcements) announcements, (SELECT COUNT(*) FROM collection_jobs) col_jobs, (SELECT COUNT(*) FROM render_jobs) render_jobs, (SELECT COUNT(*) FROM popups) popups_OPTIONAL, (SELECT COUNT(*) FROM popup_slides) slides_OPTIONAL"
npx wrangler d1 execute chhath-audit --remote --command \
  "SELECT (SELECT COUNT(*) FROM user_sessions) sessions, (SELECT COUNT(*) FROM login_attempts) attempts"
```

## Step 3 — export the file URLs, before anything is deleted

The database rows are the only index of the uploaded photos, signatures, popup
images and generated PDFs. Delete the rows first and those files stay on storage
forever with nothing left to find them by. This step is read-only.

```bash
bash mgmt/db/cleanup/2026-09-14-reset-portal-data/files/export-file-urls.sh
node mgmt/db/cleanup/2026-09-14-reset-portal-data/files/extract-keys.mjs
```

You get, under `files/out/`:

| File | Meaning |
| --- | --- |
| `r2-keys.txt` | objects in the `chhath-files` bucket — deleted in step 5 |
| `drive-links.txt` | files archived to Google Drive — **manual deletion**, `wrangler` cannot reach them |
| `unknown.txt` | anything unrecognised. Read it before step 5 |

Never emitted, on purpose: `seo/…`, `donation/…` and `users/USER0001_…`. Those
belong to configuration that survives the reset — the social preview image, the
donation QR that `portal_settings` points at, and the kept member's photo.

## Step 4 — run the SQL

In this order. Each file ends with a `VERIFY` query whose output you should read
before moving on — the expected values are stated at the bottom of each file.

```bash
C=mgmt/db/cleanup/2026-09-14-reset-portal-data
npx wrangler d1 execute chhath-core            --remote --file $C/01-core.sql
npx wrangler d1 execute chhath-collections     --remote --file $C/02-collections.sql
npx wrangler d1 execute chhath-loans-expenses  --remote --file $C/03-loans-expenses.sql
npx wrangler d1 execute chhath-file-index      --remote --file $C/04-file-index.sql
npx wrangler d1 execute chhath-whatsapp-index  --remote --file $C/05-whatsapp-index.sql
npx wrangler d1 execute chhath-logs            --remote --file $C/06-logs.sql
npx wrangler d1 execute chhath-misc            --remote --file $C/07-misc.sql
npx wrangler d1 execute chhath-audit           --remote --file $C/08-audit.sql
```

Optional — clears the announcement popups too. `07-misc.sql` prints how many
popup rows exist so you can decide:

```bash
npx wrangler d1 execute chhath-misc --remote --file $C/07b-misc-popups.sql
```

`01-core.sql` is the one to watch. Its `VERIFY` row must show `users_kept 1`,
`users_id 1`, `users_id_code USER0001`, `login_kept 1`, `login_role Superadmin`,
the five `*_rows` at 0, and the three `kept_*` counts non-zero. **If `users_kept`
is greater than 1, the fail-safe triggered** — no `USER0001` was found, so nothing
was trimmed. Go back to step 1.

Step 8 signs every device out, including yours. Logging back in is expected.

## Step 5 — delete the orphaned files

```bash
bash mgmt/db/cleanup/2026-09-14-reset-portal-data/files/delete-r2-objects.sh
```

It shows the count, asks you to type `DELETE`, then removes them one at a time
(`wrangler` has no bulk delete). Failures are collected in
`files/out/r2-delete-failed.txt` instead of aborting the run — the usual cause is
that the file had already been archived to Drive, so the R2 object was gone
already.

Then open `files/out/drive-links.txt` and delete those from the Google Drive UI,
and empty Drive's trash.

## Step 6 — bump the data version. Do not skip this.

```bash
npx wrangler d1 execute chhath-core --remote --file \
  mgmt/db/cleanup/2026-09-14-reset-portal-data/09-bump-data-version.sql
```

Without it the public portal keeps serving the **old** data for up to 30 days.
Three caches sit between D1 and a visitor:

```
portal_settings.public_data_version    the counter this bumps
      |
KV  pub:snapshot:portalData            last-known-good snapshot, 30-day TTL,
      |                                rewritten only when the version changes
      v
browser  cpm_public_portalData_v4       localStorage, keyed on the version
```

One bump invalidates all three. The `VERIFY` query prints the new value — it must
be **higher** than before. If it is unchanged, the `UNIQUE` index on
`portal_settings("key")` is missing: apply
`mgmt/db/migration/2026-09-01/08-public-data-version.sql` and run step 6 again.

## Step 7 — check the result

```bash
curl -s "https://chhath-public-worker.shaharpura.com/?action=dataVersion"
curl -s "https://chhath-public-worker.shaharpura.com/?action=summary"
```

`summary` should come back with no year totals. Then open
<https://chhath.shaharpura.com> in a **private window** (a normal window may still
hold the old `localStorage` copy until the version check runs) and confirm the
pages are empty while the Journey and Donate pages still show their content.

Finally, log in to the management portal as `USER0001` and confirm the dropdowns
and document templates are still there.

## If something goes wrong

Restore from step 0:

```bash
npx wrangler d1 execute <database> --remote --file backup-<database>-<date>.sql
```

then bump the data version again (step 6) so the public caches pick the restored
data up.

Deleted R2 objects and Drive files cannot be restored this way — the database
backup only brings back the rows that pointed at them. That is why step 3 runs
before step 5, and why step 5 asks for confirmation.
