# Cloudflare free-plan limits — review & headroom

A full pass over both Workers (mgmt + Public) checking every D1 read/write, KV
write, cron cost and per-invocation subrequest count against the Cloudflare **free
tier**. Bottom line: the app sits comfortably inside the free plan for a committee
of this size, and the two remaining fan-out hotspots are now capped.

## The limits that matter
| Resource | Free/day | Also |
|---|---|---|
| D1 rows read | 5,000,000 | |
| D1 rows written | 100,000 | |
| D1 storage | 5 GB | retention sweep trims old rows |
| Workers KV writes | ~1,000 | KV reads ~100,000/day |
| Worker requests | 100,000 | |
| Subrequests **per invocation** | **50 (hard)** | each fetch/D1 query/KV/R2 op counts |

## What protects each limit (already in place)
- **Public D1 reads** — the whole public payload is edge-cached keyed on `?v=<version>`
  (`edgeCached`/`versionCached`), confirmed `cf-cache-status: HIT`. Visitors don't
  touch D1; only `?action=dataVersion` (one tiny row) reaches the Worker per load.
  A daily D1-read budget guard (`d1BudgetExceeded`, 4M of 5M) serves cache-only once
  near the cap.
- **Cron cost** — the mgmt cron runs every 3 minutes (not every minute), 480 ticks/
  day. `processPendingJobs` claims at most 5 jobs/tick; the retention sweep runs once
  per hour, 9 bounded (`LIMIT 200`) statements. `processPendingJobs` and the sweep
  run in separate `ctx.waitUntil` contexts, so their subrequests are not summed into
  one 50-cap bucket.
- **KV writes** — every `KV.put` is conditional or sampled (verified, no unconditional
  per-request write): rate limiters are sampled, `mgmtCachePut` is cache-miss-only,
  the snapshot writes only on a version change, sessions only on login, the Drive
  token only on refresh, the docx cache only on a miss.
- **Hot mgmt reads** — cached via version-keyed KV (`CACHEABLE_ACTIONS`: getYears,
  getUsers, getHome, getLoans, getExpenses, getCommittee, getUserHistory,
  getUserProfile, dropdown lists, festival dates, …).
- **N+1 eliminated** — `getUserProfile`/`getHomeData`/announcements/consent use the
  batched IN-list lookups in `lookups.js` (CHUNK=90) and SQL `SUM()`/`COUNT()` totals,
  not per-row queries (audit H-11/M-14).
- **Message claim loops bounded** — `getPendingMessages` claims in chunks of 50.
- **Bulk PDF** — bounded-concurrency pool of 3 in the browser, one request per PDF
  (never a server-side loop), so the 50-subrequest cap can't be hit.

## The two fan-out hotspots — now fixed (this review)
1. **Per-active-group message loop** (`whatsapp.js triggerCollectionMessages`,
   `loans.js createLoanConsents`): one D1 INSERT per active WhatsApp group in a
   single invocation. Normal committee = 1-3 groups (fine), but it was uncapped.
   **Fix:** `MAX_GROUPS_PER_JOB = 20` slice, logged when exceeded — one save can no
   longer approach the 50-subrequest cap regardless of how many groups an admin
   activates. The rest get messaged on the next save.
2. **Full USERS scan in `triggerCollectionMessages`** — read the entire members
   table per collection-save job just to find one contributor + the sender number.
   **Fix:** switched to a single indexed `userByIdCode()` lookup (+ `senderNumberForLogin`
   now self-looks-up), so this path no longer scans tens of thousands of rows. This
   was the single largest D1 row-read on the save/cron path.

## Watch items (fine at this scale, no action needed)
- `getMessageLog` (Superadmin view) does a full `SELECT *` of the message tables;
  bounded by the 180-day retention sweep, view-only, not a hot path.
- `getAnnouncementQueue` / `getCollectionQueueStatus` are polled during events and
  deliberately NOT cached (must be live), but each is a couple of cheap indexed/
  grouped reads.

## Verdict
Well inside the free tier for the committee's scale. The edge cache absorbs public
traffic, the cron is throttled, KV writes are all conditional, reads are batched/
cached, and the only uncapped fan-out (WhatsApp groups) is now capped.
