# Audit findings NOT fixed — and why

Companion to the audit in PR #67. Everything Critical, High, and the Medium/Low
items with behavioural impact were fixed across PRs #68–#89. This file is the
honest remainder: what is still open, why each one was left, and what it would
take.

Nothing here is unknown or forgotten. If a reviewer disagrees with a call, the
reasoning is written down so the disagreement can be about the trade-off rather
than about whether anyone noticed.

---

## Reconciliation — 2026-09 (after PRs #90–#110)

A full re-review of this ledger against the current code. Several items listed
below have since been closed; the rest remain deferred for the SAME reasons.

**Closed since this doc was written:**

| # | Was | Now |
|---|---|---|
| **L-7** | `getFromR2` returned an unread `contentType` | Fixed — `storage.js` reads it as the Drive-upload mime fallback. |
| **L-13** | `parseAmt` duplicated in ~7 files | Consolidated in mgmt backend into `money.js` (5 copies → 1 import) — PR L-13. The two remaining single copies (`mgmt/frontend` PdfExport, `Public/frontend` non-bundled script) are the documented cross-deployment case (Q-4). |
| **L-20** | `key={i}` array-index keys in view files | Fixed on the lists that actually reorder (Committee, Expenses, Loans, LoginManagement, WhatsApp, Popup slides) — PR L-20. Append-only/never-reordered lists correctly keep `key={i}`. |
| **Q-10** | ~17 markdown files crowding the repo root | The 10 historical audit/incident notes moved to `docs/history/`; active guides stay at root — PR Q-10. |

**Assessed and deliberately LEFT (changing it is riskier than the finding):**

| # | Finding | Why left |
|---|---|---|
| **Q-8** | `READ_ONLY_ACTIONS` is a denylist-by-omission | The current default is already the SAFE direction: an action *not* in the set is treated as a write and bumps the public data-version (one harmless extra edge revalidation). A forgotten new write therefore fails safe. Inverting to an allowlist would make a forgotten new *read* bump the version unnecessarily, i.e. more cache churn for no correctness gain. The two entries that look wrong (`logError`, `reportErrorToWhatsApp`) only touch `error_log`, which is NOT part of the public payload, so not bumping for them is correct. Net: leaving it is the lower-risk choice. |

**Still deferred (unchanged reasons — see the sections below):**
H-5 (public payload shape), H-12 (cookie-vs-localStorage session), M-10 (CORS
preflight), H-16 (incremental restore), P-3 (server-side bulk PDF; note it is now
a throttled+retrying serial browser loop, an improvement but not a concurrency
pool), Q-1 (zod), M-33 (`REAL` identity columns), M-34/M-35 (FKs/CHECKs). Each is
a breaking change or a migration on live spreadsheet-origin data, and none has
become cheaper since. They remain the right things to do *when there is a staging
environment and time to verify a live-data migration* — not as a quiet pre-launch
edit.

Launch date at the time of writing: **25 October 2026.** "Post-launch" below means
"the risk of changing this now exceeds the risk of leaving it".

---

## Deferred deliberately — the fix is riskier than the finding

### H-5 — the public portal ships the whole member + finance database

`getAllPortalData` sends every member, contribution, loan and expense to every
anonymous visitor. Splitting it into per-section endpoints touches the public
frontend's entire data flow **and** the `?v=` version-keyed cache-key scheme that
is currently confirmed working at the edge (`cf-cache-status: HIT`).

Partly mitigated already: a 20 MB snapshot guard (#75) and the D1 daily budget
counter. What remains is the payload size itself.

**To do it:** split into `?section=members|collections|loans|expenses`, keep the
`?v=` key per section, and update `script.js` to fetch lazily per tab. Verify the
Cache Rule still produces `HIT` for each new URL shape before deploying.

### H-12 — session tokens in `localStorage` with a 30-day lifetime

Moving to an `HttpOnly; Secure; SameSite=Strict` cookie is the right end state,
but it is a breaking change to every request path, and it **re-introduces CSRF**
— which the current body-borne token is structurally immune to. Doing it properly
means cookie auth *plus* a CSRF token *plus* the M-10 change below, all at once.

Mitigated meanwhile: sessions are now keyed by hash in KV (#75), revoked on
password change (#83), and visible/revocable per device.

### M-10 — `api.js` omits `Content-Type` to dodge the CORS preflight

This makes every call a CORS *simple request*, so `ALLOWED_ORIGINS` is never
enforced for the request itself (only the response is hidden from an attacker).

**Not fixed because the fix has a config-dependent outage mode.** Adding the header
makes every request preflighted, and `allowedOrigin()` fails *closed*: with
`ALLOWED_ORIGINS` unset or wrong in the deployed environment it returns `null`, no
`Access-Control-Allow-Origin` is sent, and **every request from the app fails**.
Today a misconfigured `ALLOWED_ORIGINS` is invisible; afterwards it is a total
outage. The finding itself notes the gap is harmless while the token travels in the
body.

**To do it:** confirm `ALLOWED_ORIGINS` in production first, then land M-10 and
H-12 together.

### H-16 — `restoreBackup` runs a full second export in-request

Both the restore and its safety snapshot can exceed Worker limits mid-flight. An
incremental/resumable restore is a significant piece of work for an action that is
Superadmin-only and invoked approximately never. The safety snapshot now fails
*loudly* with "your data is safe, nothing was changed" (#80) rather than silently.

### P-3 — bulk PDF generation loops in the browser

Left as a browser loop on purpose: it is subrequest-safe by construction (each
conversion is a separate request), whereas moving it server-side risks the
**50-subrequest free-plan cap** inside one invocation. Bounded concurrency in the
browser is the cheaper improvement and is still worth doing.

### Q-1 — no schema validation library

~90 router actions each doing ad-hoc `if (!x) throw`. `zod` at the router boundary
is the right answer and would replace a lot of hand-written checks. It is also a
large diff across every handler three weeks before launch, and #80 has already made
every one of those throws correctly typed and correctly reported.

### M-33 — `REAL` columns that should be `INTEGER`/`TEXT`

`year`, `sl_no`, `amount`, `announcedcount` and others are `REAL` because the
original Google Sheet export made them so. Fixing it means a table rebuild
(`CREATE TABLE new … INSERT SELECT … DROP … RENAME`) per table, on live data, with
no transaction spanning the steps on D1.

The practical consequences are understood and handled where they matter: SQLite's
type affinity converts on comparison (verified in #84's tests), and `parseInt`/
`parseFloat` at the boundaries. The one real artefact — SQL `SUM()` using
compensated summation and differing from a JS loop in the 12th decimal — is
documented with a dual assertion in #79.

### M-34 / M-35 — no foreign keys, no CHECK constraints

D1 supports both, and they would have caught several bugs in this audit (the
orphaned `loan_consents` of H-8 above all). Adding them to populated tables fails
if any existing row violates them, and this data came out of a spreadsheet — so
every constraint needs a detection query and a repair pass first, exactly like the
UNIQUE indexes in #81.

**To do it:** follow the #81 pattern — ship the constraint commented out next to the
query that tells you whether it is safe to apply.

---

## Cosmetic / structural — real, but no behavioural impact

| # | Finding | Note |
|---|---|---|
| M-9 | `httpStatusForError` infers 400 vs 403 from `err.permission` | Works correctly today; an explicit `err.status` would be tidier. #80 added `InternalError`, so the shape is now consistent. |
| Q-2 | Inconsistent response shapes (`{success:true}`, bare arrays, `null`, `{status:true}`) | Normalising this is a breaking change for every frontend caller. `api.js` already handles all of them. |
| Q-3 | Table-name maps duplicated between the two Workers | Separate deployments with no shared source tree; comment-enforced. |
| Q-4 | `parseStoredDate`, `isTruthyFlag`, `driveImageUrl`, `escapeHtml` each duplicated | Same reason. **M-31 (#88) proves this class of duplication does drift** — the two `isTruthyFlag` copies disagreed on 7 real values. A shared package is the only real fix; until then the tests assert parity. |
| Q-6 | `index.js` is a ~600-line handler table | It is a flat dispatch map, which is arguably the right shape. Splitting it by domain would be nice; it changes nothing. |
| Q-8 | `READ_ONLY_ACTIONS` is a hand-maintained denylist-by-omission | A new mutating action forgotten here is treated as read-only. Worth inverting to an allowlist. |
| Q-9 | Comments doing the job of code | Fair, and partly by design in a codebase maintained by volunteers. |
| Q-10 | Nine incident-note markdown files at the repo root | Should move to `docs/history/`. Deliberately not done in this stack: moving nine files creates a large diff that would obscure the code review. |
| Q-11/Q-12 | View components are long and repetitive | True. Refactoring 11 view files pre-launch is exactly the kind of change that breaks something subtle. |
| L-6 | `filterByYear` still used by some call sites | Reduced (#87 removed it from `docxTemplates.js`); the rest are `year === 'All'` paths where it is correct. |
| L-7 | `getFromR2` returns an unread `contentType` | Harmless. |
| L-9/L-10/L-11 | Duplicated template literals and placeholder substituters in the frontend | Cosmetic; the substituters carry a "keep in sync" comment, same class as Q-4. |
| L-13 | `parseAmt` re-declared in 6 files | Same class as Q-4. All six are identical — a test could pin that. |
| L-20 | `key={i}` array-index keys in 11 view files | Causes wrong-row-highlighted glitches on reorder, not data loss. Partly addressed by P-1 (#79). |

---

## Withdrawn — findings that were wrong

Being explicit so nobody "fixes" a bug that does not exist. Each was verified
directly, not reasoned about.

| # | Claim | What is actually true |
|---|---|---|
| **L-1** | `requireStaffRole` is an unused import in `index.js` | It is used 3+ times — the H-1 work added those gates. Removing the import breaks the build. Asserted in `ops-and-cleanup.test.mjs`. |
| **M-8** | A duplicate profile email could hijack email login | Login resolves the identifier against `login_users` (`auth.js:249`); `updateOwnProfile` writes the `users` table. Different tables, no auth impact. |
| **M-22** | The post-claim re-read carries 500 placeholders too | It matches on one shared `claimToken`. Only the claim needed chunking. |
| **H-18** | A `year` stored as the string `'2026'` makes `reannounceAll` a silent no-op | SQLite applies the column's affinity to the comparison operand, so `'2026'` matches `2026.0` — verified against `node:sqlite`. The real defect is the **empty/NULL** year, which is fixed. |
| **L-16** | The Drive token KV key is un-namespaced | It was already `drive:access_token`. |
| **H-7** | `uploadFile` is ungated | Already `requireAdminOrAbove`. A regression guard was added instead. |

---

## Operational follow-ups (not code)

These need someone with production access, and none of them can be done from a PR.

1. **Run the duplicate-detection queries** from `2026-09-05/07` and `/08`. The H-9
   race may already have produced two members sharing one `USER####` — which
   silently merges their profiles, receipts and loan consents — or two donors
   holding one receipt number. Repair, then apply the UNIQUE indexes.
2. **Find consent rows orphaned by pre-#82 loan deletions.** Their tokens are still
   live. Query in #82's description.
3. **Apply migration `2026-09-01/08`** if it has not been. Without it,
   `bumpDataVersion` silently takes a lossy path and the public portal can serve
   stale data under a matching ETag. #87 makes this warn, so check the Error Log.
4. **Verify `ALLOWED_ORIGINS`** is set correctly on the mgmt Worker — a prerequisite
   for M-10 and H-12 above.
5. **Set `VITE_GTM_ID`** explicitly so nobody has to wonder again whether the
   committed container id is real (#88).
6. **Point an uptime monitor at `GET /?health=1`** on both Workers (#89 adds it to
   the public one).
