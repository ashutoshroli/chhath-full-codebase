// Public transparency portal — READ-ONLY. Bound only to core, collections,
// loans_expenses, file_index (see MIGRATION_NOTES.md flag #4 for why these 4
// and not all 8 — templates/whatsapp_index/logs/misc stay mgmt-internal).
//
// Deliberately a SEPARATE Worker deployment from mgmt-worker (confirmed with
// Vhhb) — different D1 binding scope, different wrangler.toml, different URL.
// Frontend change needed: Public/frontend just points its fetch at this
// Worker's URL with ?action=portalData, same as before.

// `dropColumns` = denylist (drop these, keep the rest). `pickColumns` = allowlist
// (keep ONLY these source columns, drop everything else) — used for tables that
// hold sensitive PII where the safe default is to expose nothing unless it's on
// the list. If `pickColumns` is provided it takes precedence over `dropColumns`.
// `includeRowIndex` (audit PUB-BE-05, related observation): `id` -> `__rowIndex` used
// to be emitted for EVERY section, so the internal autoincrement row id of every
// table this Worker reads was published to anonymous visitors. Exactly ONE resource
// needs it — a collections row's QR record id is `<docType>-<year>-<__rowIndex>`,
// which is how the Verify screen matches a paper document to its row (see
// `derive.ts` COLLECTION_DOC_TYPES). Nothing reads it from any other section, in any
// of the frontends. It is now opt-in per section, so an internal id is disclosed only
// where it is load-bearing.
async function tableRows(db, table, columnMap, dropColumns, pickColumns, includeRowIndex = false) {
  const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all();
  const allow = pickColumns ? new Set(pickColumns) : null;
  return results.map(r => {
    const out = {};
    for (const [col, val] of Object.entries(r)) {
      if (col === 'id') {
        if (includeRowIndex) out['__rowIndex'] = val;
        continue;
      }
      if (allow) {
        if (!allow.has(col)) continue;                         // allowlist: drop anything not explicitly public
      } else if (dropColumns && dropColumns.includes(col)) {
        continue;                                              // denylist: drop columns the public site doesn't need
      }
      const header = (columnMap && columnMap[col]) || col;
      out[header] = val === null ? '' : val;
    }
    return out;
  });
}

// Same header-name reversal as mgmt-worker's tableRegistry.js COLUMN_ALIASES,
// duplicated here (not imported) so this Worker has zero dependency on
// mgmt-worker's source tree — keeps the two deployments fully independent.
const REVERSE_MAPS = {
  users: { id_code: 'ID', name: 'Name', village: 'Village', fathers_name: "Father's Name ", mobile: 'Mobile ', designation: 'Designation', created_by: 'Created By', email: 'Email', whatsapp: 'WhatsApp', name_hindi: 'Name (Hindi)', fathers_name_hindi: "Father's Name (Hindi)", designation_hindi: 'Designation (Hindi)', village_hindi: 'Village (Hindi)', photo: 'Photo' },
  committee_members: { year: 'Year', name: 'Name', created_by: 'Created By', view_role: 'View Role', view_role_hindi: 'View Role (Hindi)', whatsapp: 'WhatsApp' },
  collections: { year: 'Year', sl_no: 'Sl. No.', name: 'Name', amount: 'Amount', created_by: 'Created By', payment_mode: 'Payment Mode', date: 'Date', contribution_type: 'Contribution Type', detail: 'Detail', certificate_or_receipt: 'Certificate Or Receipt', utr: 'UTR', is_resell: 'Is Resell', announced: 'Announced', announced_count: 'AnnouncedCount' },
  expenses: { year: 'Year', discription: 'Discription', amount: 'Amount', created_by: 'Created By', category: 'Category', discription_hindi: 'Discription (Hindi)' },
  loans: { year: 'Year', name: 'Name', amount: 'Amount', intrest_rate: 'Intrest Rate', tenure: 'Tenure', created_by: 'Created By', status: 'Status', loan_id: 'Loan ID', loan_status: 'Loan Status', final_repayment_date: 'Final Repayment Date' },
  loan_guarantors: { year: 'Year', loaner: 'Loaner', guarantor: 'Guarantor', created_by: 'Created By', loan_id: 'Loan ID' },
  generated_files: {}, // headers already close to snake_case originals; see file_index/schema.sql if you need exact source names
  // SECURITY (data minimization): loan_consents holds highly sensitive PII —
  // consent token, OTP, IP address, GPS geo, device/user-agent, and photo/
  // signature URLs. The public portal only needs enough to link a person to
  // their generated consent PDF, so we ship ONLY these columns (allowlist below
  // in getAllPortalData) and map their headers. Everything else never leaves the
  // Worker.
  loan_consents: { loan_id: 'loan_id', role: 'role', status: 'status', person_id: 'person_id', consent_id: 'consent_id' },
};

// The ONLY loan_consents columns the public portal is allowed to see. Matches
// exactly what Public/frontend/script.js's buildPersonDownloads() reads.
const LOAN_CONSENTS_PUBLIC_COLS = ['loan_id', 'role', 'status', 'person_id', 'consent_id'];

// audit H-5 — the core finding is "the public payload ships the whole database".
// Beyond the guarantor/consent slices already done, these are the exact DB columns
// each remaining section's frontend (Public/frontend/script.js) actually reads,
// verified field-by-field. Everything else (created_by, utr, status, dates,
// announced flags, category, loan_status, file_name, drive_path, ...) never
// reaches an anonymous visitor. Same allowlist pattern as guarantors/consents:
// fails CLOSED, so a future column can't leak. `id` -> `__rowIndex` is handled by
// tableRows() before the allowlist runs and so does NOT need listing here — but it is
// emitted only for the one section that asks for it (collections, whose QR record id
// is built from it). See the `includeRowIndex` note on tableRows.
const COMMITTEE_PUBLIC_COLS   = ['year', 'name', 'view_role', 'view_role_hindi'];
const COLLECTIONS_PUBLIC_COLS = ['year', 'name', 'amount', 'detail', 'contribution_type', 'certificate_or_receipt', 'is_resell'];
const EXPENSES_PUBLIC_COLS    = ['year', 'amount', 'discription', 'discription_hindi'];
const LOANS_PUBLIC_COLS       = ['year', 'name', 'amount', 'intrest_rate', 'tenure', 'loan_id'];
const GENERATED_FILES_PUBLIC_COLS = ['doc_type', 'year', 'record_id', 'public_link'];

// The ONLY loan_guarantors columns the public portal is allowed to see (audit H-5,
// safe slice). The public loan view (script.js renderLoans) reads exactly Year,
// Loan ID, Loaner and Guarantor from each guarantor row and derives everything
// else (village / contributor / committee status) from the users/collections/
// committee maps it already has. Previously this shipped via a DENYLIST that only
// dropped `guarantor_signature`, so `created_by` — and, more dangerously, ANY
// column added to loan_guarantors in future — leaked to every anonymous visitor.
// Switching to this ALLOWLIST (same pattern as loan_consents above) ships only the
// four rendered columns and fails CLOSED: a new sensitive column can never leak
// unless it is added here deliberately. No rendered field changes.
const LOAN_GUARANTORS_PUBLIC_COLS = ['year', 'loaner', 'guarantor', 'loan_id'];

// ============ THE PUBLIC `users` PROJECTION IS AN ALLOWLIST ============
//
// audit PUB-BE-05. This was the last section still built as a DENYLIST: `SELECT *`
// followed by "drop email, drop whatsapp, drop mobile unless committee". Every other
// section was converted to an allowlist in H-5 precisely because a denylist is the
// wrong default for the most sensitive table in the deployment:
//
//   * it already leaked `created_by` — the internal login name of the staff member
//     who entered the row — to every anonymous visitor, unread by any frontend, and
//   * it fails OPEN. Any column added to `users` later ships to the whole internet
//     the moment it is created, with no code change here and nothing to review. The
//     table has grown twice already (`photo` by migration 27, the Hindi name/village
//     /designation set before it); the next addition might be an Aadhaar reference,
//     a date of birth or an address.
//
// The exact columns below are the ones the public frontend reads — they match
// `userRow` in `Public/frontend-v6/src/lib/api/schema.ts` field for field. Anything
// not on this list now fails CLOSED, which is the whole point.
//
// `mobile` is on the list but is NOT unconditional: it is emitted only for committee
// members, which is the only place the public site renders a number (audit 1.2).
// `created_by`, `email` and `whatsapp` are simply absent, so they cannot be
// reinstated by forgetting a `continue`.
const USERS_PUBLIC_COLS = [
  'id_code', 'name', 'name_hindi',
  'village', 'village_hindi',
  'designation', 'designation_hindi',
  'fathers_name', 'fathers_name_hindi',
  'photo',
  'mobile', // committee members only — see isCommittee below
];

// Named in the SQL as well, so the row never contains a value we intend to drop.
// (Defence in depth: the response allowlist above is the control that matters, but a
// column that is never read cannot be leaked by a later refactor, and D1 bills by
// rows read — a narrower row is cheaper on a table this Worker reads in full.)
//
// `id` is deliberately absent from the projection while still driving ORDER BY:
// SQLite can order by a column it does not return, so the internal row id cannot
// reach the payload even by accident. See the `__rowIndex` note on tableRows.
const USERS_PUBLIC_SELECT =
  `SELECT ${USERS_PUBLIC_COLS.join(', ')} FROM users ORDER BY id ASC`;

// Returns the public `users` rows built from USERS_PUBLIC_COLS, with `mobile` kept
// ONLY for people who are committee members in some year (the only place the public
// site shows a mobile). Everyone else has their mobile stripped before it ever
// leaves the Worker (audit 1.2 — data minimization).
async function usersPublicSafe(env) {
  // committee_members references its member by the same value the users row is
  // keyed on (id_code, e.g. "USER0007") — mirror the frontend's
  // getUser(r.ID || r.Name) lookup. Collect every committee member identifier.
  const { results: committeeRows } = await env.DB_CORE
    .prepare('SELECT name FROM committee_members')
    .all()
    .catch(() => ({ results: [] }));
  const committeeIds = new Set(
    (committeeRows || []).map(r => (r.name == null ? '' : r.name.toString().trim())).filter(Boolean)
  );

  // An older deployment that has not applied the `photo` ADD-COLUMN migration would
  // fail the explicit projection outright ("no such column"), taking the entire
  // portal payload down with it — a worse outcome than the leak this fixes. So the
  // narrow query is attempted first and a wide read is the fallback. The RESPONSE is
  // built from the allowlist either way, so the fallback changes what is read, never
  // what is sent: the leak is closed on both paths.
  let results;
  try {
    ({ results } = await env.DB_CORE.prepare(USERS_PUBLIC_SELECT).all());
  } catch (e) {
    ({ results } = await env.DB_CORE.prepare('SELECT * FROM users ORDER BY id ASC').all());
  }

  const map = REVERSE_MAPS.users;
  return (results || []).map(r => {
    const isCommittee = committeeIds.has((r.id_code == null ? '' : r.id_code.toString().trim()));
    const out = {};
    // Iterating the ALLOWLIST rather than the row is what makes this fail closed: a
    // column the database grows tomorrow is not part of this loop, so it cannot be
    // emitted even if the SQL fallback above happened to read it.
    for (const col of USERS_PUBLIC_COLS) {
      if (col === 'mobile' && !isCommittee) continue;  // only committee mobiles are public
      if (!(col in r)) continue;                       // absent on an older deployment
      const val = r[col];
      out[map[col] || col] = val === null ? '' : val;
    }
    return out;
  });
}

// ============ ABUSE / QUOTA PROTECTION (hardening A + C) ============
//
// This is a PUBLIC, unauthenticated portal on the D1 FREE tier, whose daily
// row-read quota is SHARED with the mgmt worker (same databases). A flood of
// public requests can therefore exhaust that quota and take the WHOLE portal —
// mgmt included — offline (observed during load testing). Two lightweight guards,
// both backed by the reused KV namespace (keys prefixed "pub:"):
//
//   A) per-IP rate limit — a single IP can't hammer the Worker.
//   C) daily D1 read budget — once the day's estimated D1 reads approach the free
//      limit, the portal serves ONLY from cache and stops issuing new D1 reads,
//      so admins (mgmt) keep working instead of the quota being burned to zero.
//
// Both FAIL OPEN on any KV error (never take the site down themselves), and both
// are no-ops if KV isn't bound (older deploy) — the edge cache from the version
// design still does most of the protection.

// ============ KV BINDING (audit H-4) ============
//
// SECURITY: this Worker used to be bound to the SAME KV namespace as the mgmt API
// (identical namespace id in both wrangler.toml files). That namespace holds:
//     session:<...>        live mgmt sessions (name + role)
//     drive_access_token   a live Google Drive OAuth access token
//     mgmtcache:*          cached member PII (getUserProfile / getUsers)
//     loginfail:*, consentotp:*   lockout counters and OTP verification proofs
//
// This is a PUBLIC, unauthenticated, internet-facing Worker. The only thing keeping
// it away from those keys was a comment and the fact that today's code happens to
// touch only `pub:*` prefixes — one bug, one dependency, or one future feature away
// from full session theft and a leaked Drive credential. The two Workers also
// competed for the SAME ~1000/day KV write budget, which this file already
// documents as a real outage cause.
//
// The public Worker now has its OWN namespace, bound as KV_PUBLIC.
//
// MIGRATION SAFETY: it falls back to the old KV_SESSIONS binding when KV_PUBLIC is
// not present, so this code can be deployed BEFORE the new namespace exists and
// keeps working either way. Once wrangler.toml is switched over, remove the
// fallback. Nothing here writes anything but `pub:*` keys, so the fallback period
// is no worse than today.
function pubKv(env) {
  return (env && env.KV_PUBLIC) || (env && env.KV_SESSIONS) || null;
}

const PUB_RL_WINDOW_SECONDS = 60;
const PUB_RL_MAX = 60; // per IP per minute — generous for a real viewer, capping floods
// Estimated D1 rows read per full portal build (8 table scans, sizes vary). We
// budget on the free tier's 5,000,000/day, leaving headroom for mgmt admins.
const D1_DAILY_BUDGET = 4000000;
// Rows read per full portal build. This USED to be a flat 60,000 over-estimate,
// which was wildly wrong at this project's real size (~a few hundred rows) — a
// handful of cache-miss rebuilds (bots, link-preview crawlers, monitors, a deploy)
// would each add 60,000 to the daily counter and trip a false "D1 ~75% used" alert
// with essentially NO real traffic. We now count the ACTUAL rows the build read
// (d1BudgetAdd takes the real count), which is correct at any scale — small today,
// and still accurate if the member list grows to tens of thousands. A small floor
// covers the per-query overhead so an empty DB still counts as non-zero.
const D1_BUILD_ROWS_FLOOR = 200; // minimum charged per build (per-table query overhead)

// KV WRITE DISCIPLINE (audit): this limiter used to do a KV PUT on EVERY allowed
// request. KV free tier is ~1000 writes/day and is SHARED with the mgmt worker,
// so at festival scale (tens of thousands of requests) it blew the KV write
// quota in minutes — after which this limiter AND the D1 budget counter (both
// KV-backed) started failing, and they fail OPEN, disabling the very protection
// meant to shield the shared D1 quota. Two mitigations:
//   1. Most repeat traffic never reaches the Worker at all — the version-keyed
//      edge cache serves it (see cachedPayload). So the limiter only
//      sees cache-miss/first-touch requests.
//   2. Counting is now SAMPLED: we still READ the counter every time (reads are
//      cheap and have a far higher free quota), but only WRITE ~1 in
//      RL_SAMPLE requests, incrementing by the sample size. Statistically the
//      counter still climbs at the real rate and a sustained flood is caught,
//      while KV WRITES drop ~20x — keeping us comfortably inside the daily
//      write budget. A genuine flood from one IP still trips PUB_RL_MAX.
//
// audit M-12 — REVISITED after H-4 split the namespaces.
//
// The paragraph above is written for a namespace SHARED with the mgmt Worker, which
// is no longer the case: the public Worker now owns PUBLIC_CACHE outright (#75), so
// its ~1000 writes/day are not competing with mgmt sessions and the Drive token.
// That buys room to count more accurately, so the sample is tightened 20 -> 5:
// four times the accounting precision, still a 5x write reduction versus counting
// every request.
//
// The report suggested RL_SAMPLE = 1 for `logError`. I did NOT do that, because it
// makes things worse, not better: at sample 1 every request that reaches the
// limiter costs a KV write, and PUB_RL_MAX is 60 per IP per minute, so ONE
// attacker can spend 86,400 writes a day — ~86x the entire daily budget. The
// limiter fails OPEN when KV runs dry, so sample 1 converts a request flood into a
// quota exhaustion that DISABLES the limiter and the D1 budget guard together.
// Sampling is the thing protecting the budget, not a compromise of it.
//
// The `logError` action is instead made cheap where it was actually expensive: its
// per-IP counter is now an indexed D1 COUNT rather than a LIKE scan (M-13).
const RL_SAMPLE = 5;

async function pubRateLimited(env, ip, action) {
  try {
    const kv = pubKv(env);
    if (!kv || !ip) return false;
    const bucket = Math.floor(Date.now() / (PUB_RL_WINDOW_SECONDS * 1000));
    const key = `pub:rl:${action}:${ip}:${bucket}`;
    const cur = parseInt((await kv.get(key)) || '0', 10) || 0;
    if (cur >= PUB_RL_MAX) return true;
    // Sampled write: on average one write per RL_SAMPLE requests, each adding
    // RL_SAMPLE to the counter, so the expected value tracks the true count
    // without a write on every hit.
    if (Math.random() < 1 / RL_SAMPLE) {
      await kv.put(key, String(cur + RL_SAMPLE), { expirationTtl: PUB_RL_WINDOW_SECONDS + 5 });
    }
    return false;
  } catch (e) { return false; } // fail open
}

// True when today's estimated D1 reads have crossed the safety budget — callers
// should then serve from cache only and NOT build fresh from D1.
async function d1BudgetExceeded(env) {
  try {
    const kv = pubKv(env);
    if (!kv) return false;
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC, matches D1 reset)
    const used = parseInt((await kv.get(`pub:d1reads:${day}`)) || '0', 10) || 0;
    return used >= D1_DAILY_BUDGET;
  } catch (e) { return false; } // fail open
}

// Records that a fresh D1 build just happened (adds the per-build estimate to
// today's counter). Best-effort; TTL ~2 days so the daily key self-expires.
// audit M-23 — yes, this is a read-modify-write, and no, it cannot be made atomic
// here. Workers KV has no atomic increment; the primitives that do (Durable Objects,
// D1 with a transaction) are either paid-plan features or defeat the purpose of
// keeping the D1 budget guard off D1.
//
// So the guard is deliberately biased to UNDER-serve rather than over-spend, which
// is the safe direction for a budget:
//
//   * d1BudgetAdd now charges the ACTUAL rows the build read (countPayloadRows),
//     with a small floor — so the counter tracks real usage instead of a fixed
//     60,000 over-estimate that made an idle deployment look ~75% consumed.
//   * D1_DAILY_BUDGET is 4,000,000 against a real free-tier limit of 5,000,000,
//     leaving 1,000,000 rows of headroom for mgmt admins.
//   * It is only called on a cache MISS that performed a full build, so concurrent
//     callers are rare by construction — the version-keyed edge cache absorbs
//     essentially all repeat traffic before it reaches the Worker.
//
// The residual failure is real and worth stating plainly: N builds racing between
// the read and the write are counted once, not N times. With the over-estimate and
// the 1,000,000-row headroom above, losing a few counts costs far less than the
// margin already built in. Documented rather than silently accepted.
// `rowsRead` is the ACTUAL number of rows the build materialised (the caller passes
// it from the payload it just assembled). Falls back to the floor when unknown, so
// the counter reflects real usage instead of a fixed 60,000 over-estimate that made
// idle deployments look ~75% consumed.
async function d1BudgetAdd(env, ctx, rowsRead) {
  try {
    const kv = pubKv(env);
    if (!kv) return;
    const add = Math.max(D1_BUILD_ROWS_FLOOR, parseInt(rowsRead, 10) || 0);
    const day = new Date().toISOString().slice(0, 10);
    const key = `pub:d1reads:${day}`;
    const used = parseInt((await kv.get(key)) || '0', 10) || 0;
    const put = kv.put(key, String(used + add), { expirationTtl: 172800 });
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  } catch (e) { /* best effort */ }
}

// Count the rows in a built portal payload (sum of every section's length), so
// d1BudgetAdd charges the real cost of the D1 scans this build performed.
function countPayloadRows(data) {
  try {
    let n = 0;
    for (const v of Object.values(data || {})) if (Array.isArray(v)) n += v.length;
    return n;
  } catch (e) { return 0; }
}

// ---- Last-known-good snapshot (Option 1) ----
//
// A single long-lived copy of the portalData payload in KV, so that if D1 is
// completely unavailable (daily row limit exhausted, or an error mid-build) AND
// nothing is in the edge cache, we can still serve REAL (if slightly old) data
// with a `stale:true` flag instead of a 503. This is the last line of defence
// AFTER the edge cache + budget guard.
//
// KV WRITE DISCIPLINE: KV free tier allows ~1000 writes/day, so we do NOT write a
// snapshot on every request. We write ONLY when the data VERSION has changed
// since the last snapshot (i.e. roughly once per real data change) — the stored
// meta records which version the snapshot is for. That is a handful of writes a
// day, well within limits.
// ============ THE SNAPSHOT IS ONE VALUE, NOT TWO KEYS ============
//
// audit PUB-BE-07 (additional observation on the snapshot write). The last-known-good
// copy used to live in TWO keys written together:
//
//     pub:snapshot:portalData          <- the body
//     pub:snapshot:portalData:version  <- which version the body is for
//
// KV has no transactions, and the two puts were issued with `Promise.all` inside
// `ctx.waitUntil`, so nothing ever observed the result. If the VERSION write landed and
// the BODY write did not, the pair is left claiming that the previous version's body is
// current — and because `maybeSaveSnapshot` skips the write whenever the recorded
// version already matches, it would never be corrected. The safety net would then hold
// the wrong data permanently, and would be discovered only during the D1 outage it
// exists for, serving stale data marked as the current version.
//
// One key holding `{ version, savedAt, data }` cannot be half-written: a KV put either
// lands or it does not. It also removes the extra read the meta key needed.
const SNAPSHOT_KEY = 'pub:snapshot:portalData:v2';
// The v1 pair, still read (never written) so a deployment carrying an older snapshot
// keeps its safety net until the next data change replaces it with a v2 value.
const SNAPSHOT_KEY_V1 = 'pub:snapshot:portalData';
const SNAPSHOT_META_KEY_V1 = 'pub:snapshot:portalData:version';

async function maybeSaveSnapshot(env, ctx, version, dataObj) {
  try {
    const kv = pubKv(env);
    if (!kv) return;
    const current = await readSnapshotEnvelope(kv);
    if (current && String(current.version) === String(version)) return; // already current — no write
    // TTL was 24h: if the data didn't change for a day (a quiet, non-festival
    // period) the last-known-good snapshot EXPIRED, so a later D1 outage would
    // hit a 503/500 instead of serving stale-but-real data — exactly when the
    // fallback is needed. 30 days keeps the safety net alive through any quiet
    // stretch; it's rewritten (and its TTL refreshed) whenever data changes, and
    // it's only ONE write per real data change, so KV write budget is unaffected.
    const SNAPSHOT_TTL = 2592000; // 30 days

    // SIZE GUARD (audit H-5). A KV value is hard-capped at 25 MB. This snapshot is
    // the whole portalData payload — 8 unbounded table scans, which this file itself
    // estimates at ~60,000 rows — so at the projected 32k-member scale it can cross
    // that cap. The put() then fails, and because the whole function is wrapped in a
    // bare `catch {}` the failure was SILENT: the last-known-good fallback would
    // simply stop existing, and nobody would find out until D1 was already down and
    // the portal returned 503 instead of stale-but-real data.
    //
    // Refuse early, and say so loudly in the error log, so the operator learns while
    // the portal is still healthy rather than during an outage.
    const body = JSON.stringify({ version: String(version), savedAt: new Date().toISOString(), data: dataObj });
    const SNAPSHOT_MAX_BYTES = 20 * 1024 * 1024; // 25 MB hard limit, with headroom

    // The limit is on BYTES. `body.length` is UTF-16 CODE UNITS, and this payload is
    // full of Devanagari (`name_hindi`, `village_hindi`, `designation_hindi`,
    // `discription_hindi`), which is three UTF-8 bytes per single code unit. So the old
    // check under-counted by up to 3x on exactly the data it was written to protect: a
    // string measuring a "safe" 20 MB can be over 50 MB of UTF-8, past KV's hard cap.
    // The put would then fail — silently, inside waitUntil, under a bare catch.
    const bytes = new TextEncoder().encode(body).length;
    if (bytes > SNAPSHOT_MAX_BYTES) {
      await logPublicError(
        env, 'public-backend', 'maybeSaveSnapshot',
        `Snapshot NOT saved: the portalData payload is ${(bytes / 1048576).toFixed(1)} MB, ` +
        `over the ${SNAPSHOT_MAX_BYTES / 1048576} MB guard (KV's hard limit is 25 MB). ` +
        'The last-known-good fallback is therefore UNAVAILABLE — if D1 goes down or hits its ' +
        'daily row limit, the public portal will fail instead of serving a stale copy. ' +
        'Fix by paginating the public payload (audit H-5).',
        '', JSON.stringify({ bytes, chars: body.length, version }), ''
      );
      return;
    }

    // ONE put: atomic by construction. And its failure is no longer invisible — the
    // whole point of this value is to exist before it is needed, so an operator has to
    // learn about a failed write while the portal is still healthy.
    const write = kv.put(SNAPSHOT_KEY, body, { expirationTtl: SNAPSHOT_TTL }).catch((e) => logPublicError(
      env, 'public-backend', 'maybeSaveSnapshot',
      `Snapshot write FAILED: ${(e && e.message) || 'unknown'}. The last-known-good fallback is ` +
      'stale or missing, so a D1 outage will fail the public portal instead of serving a saved copy.',
      '', JSON.stringify({ version, bytes }), ''
    ).catch(() => {}));
    if (ctx && ctx.waitUntil) ctx.waitUntil(write); else await write;
  } catch (e) { /* best effort — snapshotting must never affect the response */ }
}

// The snapshot as `{ version, savedAt, data }`, from the v2 value or reconstructed from
// the v1 pair. Returns null when there is nothing usable.
async function readSnapshotEnvelope(kv) {
  try {
    const raw = await kv.get(SNAPSHOT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.data) return parsed;
    }
  } catch (e) { /* fall through to v1 */ }
  try {
    const [rawV1, verV1] = await Promise.all([kv.get(SNAPSHOT_KEY_V1), kv.get(SNAPSHOT_META_KEY_V1)]);
    if (!rawV1) return null;
    const data = JSON.parse(rawV1);
    if (!data || typeof data !== 'object') return null;
    // A v1 pair can disagree with itself — that is the defect this format removes — so
    // its recorded version is taken as advisory only.
    return { version: verV1 == null ? null : String(verV1), savedAt: null, data, legacy: true };
  } catch (e) { return null; }
}

// Returns a Response built from the last-known-good snapshot (marked stale), or
// null if no snapshot exists. Never touches D1.
async function serveSnapshot(env, cors) {
  try {
    const kv = pubKv(env);
    if (!kv) return null;
    const envelope = await readSnapshotEnvelope(kv);
    if (!envelope) return null;
    const data = envelope.data;
    // `savedAt` is what the frontend shows as the age of a saved copy (PUB-FE-01, #328),
    // and it now comes from the snapshot itself rather than being unknowable.
    if (envelope.savedAt) data.savedAt = envelope.savedAt;
    return new Response(JSON.stringify({ ...data, stale: true, staleReason: 'Live data source is temporarily unavailable; showing the most recent saved copy.' }), {
      // no-store: this is a degraded copy, don't let it get cached as if fresh.
      headers: { ...cors, 'Cache-Control': 'no-store' },
    });
  } catch (e) { return null; }
}

async function getAllPortalData(env) {
  return {
    // Public transparency portal only needs Name/Village/Father's Name/
    // Designation/Mobile for display (Mobile is shown next to Committee
    // members) — email and personal WhatsApp numbers are never rendered on
    // the public site, so they're dropped here rather than shipped to every
    // visitor's browser (data-minimization — see MIGRATION_NOTES.md flag).
    // PII minimization (audit 1.2): the public site only renders a mobile number
    // next to COMMITTEE members (via the users map — see Public/frontend
    // renderCommittee), but this payload used to ship `mobile` for EVERY user to
    // every anonymous visitor. We now drop `mobile` for everyone who is NOT a
    // committee member (in any year), so a plain contributor's number never
    // leaves the server while committee mobiles still render as before.
    users: await usersPublicSafe(env),
    // audit H-5: all sections below use an ALLOWLIST of exactly the columns the public
    // frontend reads (verified field-by-field), so nothing extra leaves the server and
    // any future column fails closed.
    //
    // PUB-BE-05: `id` -> `__rowIndex` is now requested by exactly ONE section. The
    // collections row id is load-bearing — it is the `<docType>-<year>-<id>` record id
    // the Verify screen matches a paper document against — and no frontend reads it
    // from anywhere else, so publishing the internal row ids of the other seven
    // tables bought nothing.
    committee: await tableRows(env.DB_CORE, 'committee_members', REVERSE_MAPS.committee_members, null, COMMITTEE_PUBLIC_COLS),
    collections: await tableRows(env.DB_COLLECTIONS, 'collections', REVERSE_MAPS.collections, null, COLLECTIONS_PUBLIC_COLS, true),
    expenses: await tableRows(env.DB_LOANS_EXPENSES, 'expenses', REVERSE_MAPS.expenses, null, EXPENSES_PUBLIC_COLS),
    loans: await tableRows(env.DB_LOANS_EXPENSES, 'loans', REVERSE_MAPS.loans, null, LOANS_PUBLIC_COLS),
    guarantors: await tableRows(env.DB_LOANS_EXPENSES, 'loan_guarantors', REVERSE_MAPS.loan_guarantors, null, LOAN_GUARANTORS_PUBLIC_COLS),
    generatedFiles: await tableRows(env.DB_FILE_INDEX, 'generated_files', REVERSE_MAPS.generated_files, null, GENERATED_FILES_PUBLIC_COLS),
    loanConsents: await tableRows(env.DB_LOANS_EXPENSES, 'loan_consents', REVERSE_MAPS.loan_consents, null, LOAN_CONSENTS_PUBLIC_COLS),
    // "Our Journey" year-by-year story (DB-driven, managed in the mgmt portal).
    // A missing table on an older deployment degrades to [] rather than failing.
    journeyEntries: await getJourneyEntries(env),
    // The journey tagline (bilingual), from the same portal_settings key/value
    // table this Worker already reads for the data version + SEO.
    journeyTagline: await getJourneyTagline(env),
    // The rest of the "Our Journey" static prose (intro, origin, timeline,
    // milestones, closing, labels…) — one JSON blob per language in
    // portal_settings. The frontend falls back to its built-in i18n per field.
    journeyPageText: await getJourneyPageText(env),
    // The "Donate Now" page fields (UPI id, QR image URL, bank details, WhatsApp
    // number), from the same portal_settings key/value table. All fail-soft to ''
    // so the frontend hides any field that has not been filled in yet.
    donation: await getDonationSettings(env),
  };
}

// The public "Donate Now" settings from portal_settings (donation_*). Returns an
// object of string fields, each '' when its row is missing, so the frontend can
// hide empty fields (e.g. the QR image is only shown when qrUrl is set). Mirrors
// getJourneyTagline's fail-soft read on an older backend / missing table.
async function getDonationSettings(env) {
  const out = {
    upiId: '',
    qrUrl: '',
    bankAccountName: '',
    bankName: '',
    accountNumber: '',
    ifsc: '',
    whatsapp: ''
  };
  if (!env || !env.DB_CORE) return out;
  const KEYS = {
    donation_upi_id: 'upiId',
    donation_qr_url: 'qrUrl',
    donation_bank_account_name: 'bankAccountName',
    donation_bank_name: 'bankName',
    donation_account_number: 'accountNumber',
    donation_ifsc: 'ifsc',
    donation_whatsapp: 'whatsapp'
  };
  try {
    const keys = Object.keys(KEYS);
    const placeholders = keys.map(() => '?').join(', ');
    const { results } = await env.DB_CORE
      .prepare(`SELECT "key", value FROM portal_settings WHERE "key" IN (${placeholders})`)
      .bind(...keys)
      .all();
    for (const r of results || []) {
      const field = KEYS[r.key];
      if (field) out[field] = r.value || '';
    }
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).toLowerCase();
    if (!msg.includes('no such table') && !msg.includes('no such column')) throw e;
  }
  return out;
}

// The Decade page's static text blocks, stored as two portal_settings JSON rows
// (journey_page_text_en / _hi). Returns { en: {...}, hi: {...} }; a missing row
// or bad JSON degrades to an empty object so the frontend uses its i18n default.
async function getJourneyPageText(env) {
  const out = { en: {}, hi: {} };
  if (!env || !env.DB_CORE) return out;
  try {
    const { results } = await env.DB_CORE
      .prepare('SELECT "key", value FROM portal_settings WHERE "key" IN (?, ?)')
      .bind('journey_page_text_en', 'journey_page_text_hi')
      .all();
    for (const r of results || []) {
      const lang = r.key === 'journey_page_text_hi' ? 'hi' : 'en';
      try {
        const obj = JSON.parse((r.value || '{}').toString());
        if (obj && typeof obj === 'object') out[lang] = obj;
      } catch (e) { /* leave as {} — frontend falls back to i18n */ }
    }
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).toLowerCase();
    if (!msg.includes('no such table') && !msg.includes('no such column')) throw e;
  }
  return out;
}

// Public "Our Journey" entries — read-only, only the columns the portal renders.
// Ordered by position then year. Fails soft ([]) on a missing table/column.
async function getJourneyEntries(env) {
  if (!env || !env.DB_CORE) return [];
  try {
    const { results } = await env.DB_CORE
      .prepare('SELECT year, title_en, title_hi, content_en, content_hi, position FROM journey_entries ORDER BY position ASC, year ASC')
      .all();
    return (results || []).map(r => ({
      year: r.year == null ? '' : Number(r.year),
      title_en: r.title_en || '',
      title_hi: r.title_hi || '',
      content_en: r.content_en || '',
      content_hi: r.content_hi || '',
    }));
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).toLowerCase();
    if (msg.includes('no such table') || msg.includes('no such column')) return [];
    throw e;
  }
}

// The bilingual journey tagline from portal_settings (journey_tagline_en/_hi).
// Returns { en, hi } with '' fallbacks so the frontend can fall back to its
// built-in default when both are empty.
async function getJourneyTagline(env) {
  const out = { en: '', hi: '' };
  if (!env || !env.DB_CORE) return out;
  try {
    const { results } = await env.DB_CORE
      .prepare('SELECT "key", value FROM portal_settings WHERE "key" IN (?, ?)')
      .bind('journey_tagline_en', 'journey_tagline_hi')
      .all();
    for (const r of results || []) {
      if (r.key === 'journey_tagline_en') out.en = r.value || '';
      if (r.key === 'journey_tagline_hi') out.hi = r.value || '';
    }
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).toLowerCase();
    if (!msg.includes('no such table') && !msg.includes('no such column')) throw e;
  }
  return out;
}

// audit H-5 — per-year AGGREGATES only, computed in SQL (SUM/COUNT), NOT by shipping
// rows. This is what the public landing view actually needs for its headline totals;
// the detailed lists still come from portalData, loaded lazily per tab. Returns a
// tiny object: { years: [{ year, collectionTotal, collectionCount, expenseTotal,
// expenseCount, loanTotal, loanCount }] }.
//
// Each query is a single grouped aggregate — cheap, and the whole thing is cached
// under the version key exactly like portalData, so it runs at most once per data
// version. A missing table/column on an older deployment degrades to zero rows for
// that metric rather than failing the summary.
async function getPortalSummary(env) {
  const safeAgg = async (db, sql) => {
    if (!db) return [];
    try {
      const { results } = await db.prepare(sql).all();
      return results || [];
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).toLowerCase();
      if (msg.includes('no such table') || msg.includes('no such column')) return [];
      throw e; // a real error still fails loudly (caught by the outer snapshot fallback)
    }
  };

  const [coll, exp, loan] = await Promise.all([
    safeAgg(env.DB_COLLECTIONS, 'SELECT year, COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM collections GROUP BY year'),
    safeAgg(env.DB_LOANS_EXPENSES, 'SELECT year, COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM expenses GROUP BY year'),
    safeAgg(env.DB_LOANS_EXPENSES, 'SELECT year, COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM loans GROUP BY year'),
  ]);

  // Merge the three per-year aggregates into one keyed map, then emit a sorted array.
  const byYear = new Map();
  const yr = (v) => (v === null || v === undefined ? '' : String(parseInt(v, 10) || v));
  const bump = (rows, tKey, cKey) => {
    for (const r of rows) {
      const y = yr(r.year);
      const cur = byYear.get(y) || { year: y, collectionTotal: 0, collectionCount: 0, expenseTotal: 0, expenseCount: 0, loanTotal: 0, loanCount: 0 };
      cur[tKey] = Number(r.total) || 0;
      cur[cKey] = Number(r.n) || 0;
      byYear.set(y, cur);
    }
  };
  bump(coll, 'collectionTotal', 'collectionCount');
  bump(exp, 'expenseTotal', 'expenseCount');
  bump(loan, 'loanTotal', 'loanCount');

  const years = [...byYear.values()].sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
  return { years };
}

// ---- Public popups (read-only, scoped to ONLY popups + popup_slides — never
// any other table in the misc DB, per the "no extra data" requirement) ----
//
// `popups.active` is a TEXT column, so a bound 1 is stored as '1' and the sheet
// migration wrote 'True'. Accept every form — see mgmt/backend/src/popups.js.
function isTruthyFlag(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  const s = v.toString().trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

// Legacy rows use '2026-08-22 14:31:00' (space-separated, no timezone); such a stamp
// is read as UTC. New rows are written as ISO with an explicit offset.
//
// The zone is applied BEFORE parsing on purpose — V8 accepts the space form and reads
// it as LOCAL time, so normalizing only after a failed parse would fix Safari and
// leave V8 silently off by the local UTC offset. Must stay identical to
// parseStoredDate in mgmt/backend/src/popups.js or the two portals will disagree
// about which popups are live.
function parseStoredDate(v) {
  if (!v) return null;
  const raw = v.toString().trim();
  if (!raw) return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  let d = new Date(raw.replace(' ', 'T') + (hasZone ? '' : 'Z'));
  if (!isNaN(d.getTime())) return d;
  d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// A stored schedule stamp is one of THREE things, and conflating two of them is a
// bug (audit PUB-BE-04, additional observation "malformed dates fail open"):
//
//   empty / absent  -> that end of the window is deliberately unbounded
//   parseable       -> a real instant
//   non-empty junk  -> we do NOT know when this popup is supposed to run
//
// `parseStoredDate` returns null for the first AND the third, so `if (start && start
// > now)` skipped the check entirely for a typo'd stamp: a popup with
// `start_at = '22/08/2026'` (or a half-typed value saved from the admin UI) went
// live IMMEDIATELY and stayed live forever, which is the exact opposite of what the
// person scheduling it asked for. A schedule we cannot read must fail CLOSED.
//
// Returns `{ start, end, unreadable }`. `unreadable` means "do not serve this".
function popupWindow(p) {
  const startRaw = p.start_at == null ? '' : p.start_at.toString().trim();
  const endRaw = p.end_at == null ? '' : p.end_at.toString().trim();
  const start = startRaw ? parseStoredDate(startRaw) : null;
  const end = endRaw ? parseStoredDate(endRaw) : null;
  return { start, end, unreadable: Boolean((startRaw && !start) || (endRaw && !end)) };
}

// Is this popup inside its scheduled window right now? Kept as one predicate so the
// SQL pre-filter below can never quietly become the real decision.
function popupIsLiveNow(p, now) {
  if (!isTruthyFlag(p.active)) return false;
  const { start, end, unreadable } = popupWindow(p);
  if (unreadable) return false;   // fail closed — see popupWindow
  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

// Per-slide auto-play duration in ms. NULL/0/missing -> 5000ms; clamped to
// 1000-60000ms so a stray 0 can't cause slide flicker. MUST stay identical to
// normalizeDurationMs in mgmt/backend/src/popups.js.
function normalizeSlideDurationMs(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return 5000;
  if (n < 1000) return 1000;
  if (n > 60000) return 60000;
  return n;
}

// SQLite's variable limit is far higher than this, but a popup list is tiny and
// chunking keeps one runaway row count from producing an enormous statement.
const POPUP_SLIDE_ID_CHUNK = 50;

// A DELIBERATELY PERMISSIVE pre-filter. It exists only to stop reading rows that
// could never qualify — `popupIsLiveNow` and the role check below remain the real
// decision, so if this clause is ever wrong it can only let too MANY rows through,
// never hide a popup that should be shown.
//
// Both halves must therefore be at least as generous as the JS predicate:
//   * `active` is TEXT, holding '1' from the portal and 'True' from the sheet
//     migration, so this matches every spelling `isTruthyFlag` accepts. (`active = 1`
//     alone was the original bug — TEXT affinity made it match '1' but never 'True'.)
//   * `roles LIKE '%Public%'` is broader than the exact-token check in JS on purpose.
const ELIGIBLE_POPUPS_SQL = `
  SELECT popup_id, title, roles, active, start_at, end_at FROM popups
   WHERE roles LIKE '%Public%'
     AND (active = 1 OR lower(trim(active)) IN ('1', 'true', 'yes'))`;

async function getActivePublicPopups(env) {
  if (!env.DB_MISC) return []; // binding not configured yet — fail closed, not open
  // `new Date(Date.now())` rather than `new Date()`: identical instant, but the clock
  // is read through one function, so eligibility and the cache bucket in the handler
  // cannot disagree about what "now" is, and a test can pin both at once.
  const now = new Date(Date.now());
  const { results: candidates } = await env.DB_MISC.prepare(ELIGIBLE_POPUPS_SQL).all();
  const popups = (candidates || []).filter(p => {
    if (!popupIsLiveNow(p, now)) return false;
    const rolesList = (p.roles || '').split(',').map(r => r.trim()).filter(Boolean);
    // Only popups explicitly tagged "Public" in mgmt's Popup Management show
    // here — a popup with no roles at all is treated as mgmt-internal-only,
    // so Superadmin must opt a popup into the Public role deliberately.
    return rolesList.includes('Public');
  });
  if (!popups.length) return [];

  // Was an unconditional `SELECT ... FROM popup_slides` — every slide of every
  // popup, including the ones just filtered out, on every cache miss. D1 bills rows
  // READ, and this Worker's budget is shared with the management API, so fetching
  // the slides of popups nobody can see is quota spent on nothing.
  const eligibleIds = popups.map(p => p.popup_id);
  const slides = [];
  for (let i = 0; i < eligibleIds.length; i += POPUP_SLIDE_ID_CHUNK) {
    const group = eligibleIds.slice(i, i + POPUP_SLIDE_ID_CHUNK);
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await env.DB_MISC.prepare(
      `SELECT slide_id, popup_id, slide_order, image_url, text, link_url, link_text, duration_ms
         FROM popup_slides WHERE popup_id IN (${placeholders})`
    ).bind(...group).all();
    for (const r of results || []) slides.push(r);
  }

  return popups
    .map(p => ({
      popup_id: p.popup_id,
      title: p.title,
      slides: slides
        .filter(s => s.popup_id === p.popup_id)
        // Coalesce NULLs — the migrated slide row has text/link_url/link_text NULL.
        .map(s => ({
          slide_id: s.slide_id,
          slide_order: parseInt(s.slide_order) || 0,
          image_url: s.image_url || '',
          text: s.text || '',
          link_url: s.link_url || '',
          link_text: s.link_text || '',
          // Auto-play duration (ms). NULL/0/missing -> 5000ms default, clamped to
          // 1000-60000ms. Kept identical to normalizeDurationMs in the mgmt
          // Worker's popups.js so the two never disagree.
          duration_ms: normalizeSlideDurationMs(s.duration_ms),
        }))
        // Ordered here rather than in SQL: the rows now arrive in chunks, so a
        // per-statement ORDER BY would only sort within a chunk.
        .sort((a, b) => a.slide_order - b.slide_order),
    }))
    .filter(p => p.slides.length > 0);
}

// ---- Error logging (was COMPLETELY ABSENT from this Worker) ----
//
// This whole portal used to be a total blind spot:
//   * wrangler.toml deliberately did NOT bind DB_LOGS, so the Worker physically
//     could not write to error_log;
//   * the fetch handler had NO try/catch at all, so any D1 failure inside
//     getAllPortalData()'s 8 sequential table scans became an unhandled rejection
//     -> Cloudflare "1101 Worker threw exception" -> invisible to the committee;
//   * Public/frontend/script.js had no window.onerror, no unhandledrejection and
//     no reporting of any kind.
// DB_LOGS is now bound (see wrangler.toml) and this is the ONLY table this Worker
// ever writes to — everything else stays strictly read-only.
const LOG_DEDUP_WINDOW_MS = 5 * 60 * 1000;

// Cryptographically secure hex id. Must stay identical in behaviour to
// mgmt/backend/src/random.js randomHex() — the two Workers are separate
// deployments with no shared source tree, so this is a deliberate copy.
function randomHexId(bytes = 8) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, '0');
  return out;
}

// ---------------------------------------------------------------------------
// WRITE EXCEPTION #2 — push_subscriptions (chhath-core)
//
// This Worker is READ-ONLY by convention (see wrangler.toml / MIGRATION_NOTES.md).
// `error_log` was the first blessed exception; this is the second and, like it,
// is deliberately narrow: the ONLY statement below is an upsert of ONE row into
// the ONE table `push_subscriptions`, and nothing else in this Worker writes.
//
// Why it has to live here: the public frontend can only reach THIS Worker (the
// mgmt Worker's ALLOWED_ORIGINS is locked to the mgmt domains and every action
// needs a session), so a visitor opting in to notifications must land here. Only
// the SUBSCRIPTION is stored here — sending (and therefore the VAPID PRIVATE key)
// stays in the mgmt Worker, which binds this same physical database.
//
// A subscription is an opaque browser handle: no personal data, never joined to a
// contributor/user row. `endpoint` has a UNIQUE index (migration
// 2026-09-05/31-push-subscriptions.sql), so a browser re-subscribing refreshes
// its existing row instead of creating duplicates.
const PUSH_ENDPOINT_MAX = 500;
const PUSH_KEY_MAX = 200;
const PUSH_UA_MAX = 200;

// An IPv4 literal, or anything bracketed (an IPv6 literal as a URL host).
const IP_LITERAL_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/;

// Is this a URL a real push service could plausibly have issued? A push endpoint is
// always an absolute https URL on a public DNS name, so everything rejected below is
// something no browser would ever produce (audit PUB-BE-06).
//
// This is deliberately a shape check and not a host allow-list. Pinning the four push
// services in use today (`fcm.googleapis.com`, Mozilla, Windows, Apple) would break
// every visitor on a browser that later adds a fifth — and the endpoint is not a
// secret, so the value of pinning is bounded. What must be impossible is storing a
// delivery target that points somewhere INTERNAL, which is what this rules out.
function isPlausiblePushEndpoint(endpoint) {
  if (!endpoint) return false;
  let u;
  try {
    u = new URL(endpoint);
  } catch (e) {
    return false; // not a URL at all — previously stored as long as it began "https://"
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;      // credentials in a stored URL
  const host = u.hostname.toLowerCase();
  if (!host || IP_LITERAL_HOST.test(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (!host.includes('.')) return false;           // no public DNS name
  return true;
}

async function savePushSubscription(env, body, userAgent) {
  try {
    if (!env.DB_CORE) return { success: false, message: 'Not available' };
    const clamp = (v, n) => (v === undefined || v === null ? '' : v.toString().trim()).slice(0, n);

    // Accept either the raw PushSubscription JSON shape or a flattened one.
    const sub = body && typeof body.subscription === 'object' && body.subscription ? body.subscription : body || {};
    const keys = (sub && typeof sub.keys === 'object' && sub.keys) || {};
    // Rejected BEFORE clamping: truncating an over-long endpoint to 500 characters
    // silently invents a different URL and stores it as if the visitor had sent it.
    // An endpoint past the cap is a bad request, not something to trim.
    const rawEndpoint = (sub.endpoint === undefined || sub.endpoint === null ? '' : sub.endpoint.toString().trim());
    if (rawEndpoint.length > PUSH_ENDPOINT_MAX) {
      return { success: false, invalid: true, message: 'Invalid subscription' };
    }
    const endpoint = rawEndpoint;
    const p256dh = clamp(keys.p256dh ?? sub.p256dh, PUSH_KEY_MAX);
    const auth = clamp(keys.auth ?? sub.auth, PUSH_KEY_MAX);

    // audit PUB-BE-06. This was `/^https:\/\//i.test(endpoint)`, which accepts any
    // string that merely STARTS with https:// — `https://` alone, `https://localhost`,
    // `https://10.0.0.1/x`, `https://user:pw@host/x`. The row is a delivery target the
    // mgmt Worker later POSTs to, so what is stored here decides where a future
    // request is sent: garbage in this column is a stored-request-forgery target, and
    // arbitrary strings turn the table into free storage. Parse it properly instead.
    if (!isPlausiblePushEndpoint(endpoint) || !p256dh || !auth) {
      return { success: false, invalid: true, message: 'Invalid subscription' };
    }

    const now = new Date().toISOString();
    const ua = clamp(userAgent, PUSH_UA_MAX);
    await env.DB_CORE.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, active, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         active = 1,
         last_error = NULL,
         updated_at = excluded.updated_at`
    )
      .bind(endpoint, p256dh, auth, ua, now, now)
      .run();
    return { success: true };
  } catch (e) {
    // Never surface internals to an anonymous caller; the opt-in simply fails.
    console.error('[public savePushSubscription] failed:', e && e.message);
    return { success: false, message: 'Could not save the subscription' };
  }
}

// Per-IP rate limit for the public logError endpoint (audit 1.3). This Worker
// has no KV binding, so the limiter is enforced against error_log itself: at
// most PUBLIC_LOG_MAX_PER_IP distinct rows may originate from one edge IP within
// PUBLIC_LOG_WINDOW_MS. The de-dup below already collapses IDENTICAL messages,
// but a loop generating UNIQUE messages could still flood the log and burn D1
// writes; this closes that. The edge IP is stamped into `context` (JSON) so the
// count is per-IP. Fails OPEN (allows the write) if the count query errors, so a
// D1 hiccup never silently drops real errors.
const PUBLIC_LOG_WINDOW_MS = 60 * 1000;
const PUBLIC_LOG_MAX_PER_IP = 20;

async function logPublicError(env, source, page, message, stack, context, clientIp) {
  try {
    if (!env.DB_LOGS) return { success: false };
    const clamp = (v, n) => (v === undefined || v === null ? '' : v.toString()).slice(0, n);
    const src = clamp(source || 'public', 100);
    const pg = clamp(page, 200);
    const msg = clamp(message, 1000);
    const ip = (clientIp || '').toString().trim();

    // Fold the edge IP into the stored context so the per-IP limiter can count it.
    let ctxObj = {};
    if (context) {
      try { ctxObj = typeof context === 'string' ? JSON.parse(context) : context; }
      catch (e) { ctxObj = { note: context.toString().slice(0, 200) }; }
    }
    if (ip) ctxObj.edgeIp = ip;
    const ctx = clamp(JSON.stringify(ctxObj), 500);

    // Per-IP cap (only when we actually know the IP).
    //
    // audit M-13: this used to count with
    //     WHERE created_at >= ? AND context LIKE '%"edgeIp":"1.2.3.4"%'
    // A leading-wildcard LIKE can never use an index, so every public JS error cost
    // a partial scan of error_log — on an ANONYMOUS endpoint that also INSERTs. The
    // limiter meant to make abuse cheap was the expensive part, and it degraded as
    // the table grew, i.e. exactly when a flood is under way.
    //
    // `client_ip` is a real indexed column (migration 2026-09-05/09). Falls back to
    // the old LIKE if that migration has not been applied yet, so this deploys in
    // either order — but the fallback is a scan, so apply the migration.
    if (ip) {
      const windowStart = new Date(Date.now() - PUBLIC_LOG_WINDOW_MS).toISOString();
      let cnt = await env.DB_LOGS.prepare(
        'SELECT COUNT(*) AS n FROM error_log WHERE client_ip = ? AND created_at >= ?'
      ).bind(ip, windowStart).first().catch(() => undefined);
      if (cnt === undefined) {
        cnt = await env.DB_LOGS.prepare(
          "SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ? AND context LIKE ?"
        ).bind(windowStart, `%"edgeIp":"${ip}"%`).first().catch(() => null);
      }
      if (cnt && (parseInt(cnt.n) || 0) >= PUBLIC_LOG_MAX_PER_IP) {
        return { success: false, rateLimited: true };
      }
    }

    // Same de-duplication as the mgmt logger: a public page reload loop must not
    // be able to flood the Superadmin's 300-row error view.
    const since = new Date(Date.now() - LOG_DEDUP_WINDOW_MS).toISOString();
    const dupe = await env.DB_LOGS.prepare(
      'SELECT error_id FROM error_log WHERE source = ? AND page = ? AND message = ? AND created_at >= ? LIMIT 1'
    ).bind(src, pg, msg, since).first().catch(() => null);
    if (dupe && dupe.error_id) return { success: true, errorId: dupe.error_id, deduped: true };

    // SECURITY (audit C-4): `Date.now() + Math.random()` collided whenever two
    // errors were logged in the same millisecond, and error_id has a UNIQUE index
    // (migration 2026-09-01/04-logs.sql) — so a collision made the INSERT throw and
    // the error vanish. This Worker is a separate deployment and cannot import the
    // mgmt Worker's random.js, so it keeps its own copy on purpose (same convention
    // as isTruthyFlag / parseStoredDate above).
    const id = 'ERR' + randomHexId(8);
    await env.DB_LOGS.prepare(
      'INSERT INTO error_log (error_id, source, page, message, stack, context, created_at, reported, client_ip) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
    ).bind(id, src, pg, msg, clamp(stack, 2000), ctx, new Date().toISOString(), ip || '').run()
      // audit M-13: if migration 2026-09-05/09 has not been applied yet the
      // client_ip column does not exist. Retry without it rather than losing the
      // error report, so the Worker and the migration can deploy in either order.
      .catch(async (err) => {
        if (!/client_ip/i.test((err && err.message) || '')) throw err;
        return env.DB_LOGS.prepare(
          'INSERT INTO error_log (error_id, source, page, message, stack, context, created_at, reported) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
        ).bind(id, src, pg, msg, clamp(stack, 2000), ctx, new Date().toISOString()).run();
      });
    return { success: true, errorId: id };
  } catch (e) {
    console.error('[public logPublicError] failed:', e && e.message);
    return { success: false };
  }
}

// ---- Data-version driven caching (ETag) ----
//
// The mgmt Worker bumps a single counter (portal_settings.public_data_version in
// DB_CORE) after every write. We turn that counter into a weak ETag so the
// browser/CDN can revalidate cheaply: if the client sends back the same ETag via
// If-None-Match, nothing has changed since they last fetched, and we answer
// `304 Not Modified` with NO body and NO table scans. Only when the version
// actually moved do we build and send the full payload again.
//
// `Cache-Control: no-cache` here does NOT mean "don't cache" — it means "you may
// cache, but you MUST revalidate with the server before reusing". Combined with
// the ETag that revalidation is a single tiny conditional request. This is
// exactly the "serve from cache until the data changes" behaviour we want.
const DATA_VERSION_KEY = 'public_data_version';

// audit PUB-BE-07 (additional observation: "version failures collapse to a
// valid-looking version 0").
//
// This used to answer `'0'` for three completely different situations: the counter row
// genuinely does not exist yet, the binding is missing, and *the read failed*. Only the
// first of those is a version.
//
// `'0'` is not an error value here — it is a perfectly usable version string, and this
// Worker builds its entire caching identity out of it. So a D1 hiccup meant:
//
//   * the payload built during the failure — possibly empty, since the section reads
//     were failing too — was cached under the key `v=0` and given an ETag of `…-v0`, and
//   * every later failure produced the same `v=0` identity, so that one bad build was
//     served back as a cache HIT, indefinitely, to everyone.
//
// A version we could not read is now `null`, and a caller that needs one to answer
// safely says so instead of inventing a value. An absent row is still `'0'`: a fresh
// deployment the mgmt Worker has never bumped really is at version zero.
async function getDataVersion(env) {
  try {
    if (!env || !env.DB_CORE) return null;
    const row = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?')
      .bind(DATA_VERSION_KEY).first();
    if (row === undefined) return null;               // read did not answer
    return (row && row.value != null ? row.value.toString() : '0') || '0';
  } catch (e) {
    return null;
  }
}

// What to answer when the data version cannot be read. Nothing cacheable can be built
// without it — the key and the ETag are derived from it — so the choice is between a
// real last-known-good copy and an honest failure. Never a fabricated version.
async function versionUnavailable(env, cors, action) {
  if (action === 'portalData') {
    const snap = await serveSnapshot(env, cors);
    if (snap) return snap;
  }
  return new Response(
    JSON.stringify({
      status: false,
      unavailable: true,
      message: 'Unable to load data. Please try again in a little while.',
    }),
    { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } }
  );
}

// Reads the four public SEO/link-preview fields the Superadmin manages in the
// management portal (stored in the SAME portal_settings table this Worker
// already reads for the data version). Returns empty strings on any miss/error;
// build.mjs then falls back to the hardcoded HTML defaults, so an empty result
// is always safe.
const PUBLIC_SEO_KEYS = {
  title: 'seo_public_title',
  description: 'seo_public_description',
  keywords: 'seo_public_keywords',
  image: 'seo_public_image',
};

async function getPublicSeoSettings(env) {
  const out = { title: '', description: '', keywords: '', image: '' };
  try {
    if (!env || !env.DB_CORE) return out;
    const keys = Object.values(PUBLIC_SEO_KEYS);
    const placeholders = keys.map(() => '?').join(', ');
    const { results } = await env.DB_CORE
      .prepare(`SELECT "key", value FROM portal_settings WHERE "key" IN (${placeholders})`)
      .bind(...keys)
      .all();
    const byKey = {};
    for (const r of results || []) byKey[r.key] = r.value;
    for (const [field, key] of Object.entries(PUBLIC_SEO_KEYS)) {
      out[field] = byKey[key] != null ? byKey[key].toString() : '';
    }
    return out;
  } catch (e) {
    return out;
  }
}

// A weak ETag scoped per action (portalData vs activePopups) so the two payloads
// never collide on the same version string.
function etagFor(action, version) {
  return `W/"${action}-v${version}"`;
}

// ============ ONE CANONICAL CACHE KEY PER (ACTION, DATA VERSION) ============
//
// A `Cache-Control: immutable` header alone tells the BROWSER to cache, but a
// Worker response is NOT put on Cloudflare's edge automatically — and Cache Rules
// don't reliably apply to *.workers.dev. So we cache explicitly here: on a HIT the
// big payload is returned without ever reading D1; on a MISS we build it once.
//
// audit PUB-BE-01 — this used to be TWO caches with two different key schemes:
//
//   * the fast path keyed on the CLIENT'S OWN REQUEST URL, and
//   * the fallback path keyed on a synthetic internal URL carrying the live version.
//
// Keying on the client's URL is the bug. The cache key then includes every query
// parameter the caller chose to send, and this Worker only ever reads `action`,
// `v` and `health` — so `?action=portalData&v=7&x=1`, `&x=2`, `&x=3` … are all
// DISTINCT keys for the SAME payload. Each one misses, and each miss runs a full
// portalData build: nine table scans across four databases. One trivial loop
// varying a junk parameter therefore bypasses the edge cache completely and burns
// the D1 daily row quota that this Worker SHARES with the management API — the
// exact outage this file's own budget guard exists to prevent. The same
// fragmentation happens innocently: any tracking/cache-buster parameter (utm_*,
// fbclid, a monitor's nonce) got its own copy, and the two schemes meant the fast
// and fallback paths never shared a build even for identical data.
//
// A second, quieter problem: a whole Response was stored, so the CORS
// `Access-Control-Allow-Origin` of whoever caused the MISS was cached and replayed
// to later callers from a different origin (Cache API Vary support on
// `caches.default` is limited, so the `Vary: Origin` header could not be relied on
// to prevent it).
//
// Both are fixed the same way: cache ONLY the JSON body, under a canonical key
// derived from nothing but the action and the live data version. Per-request
// headers (CORS, ETag, Cache-Control) are attached by the caller afterwards, so
// they are never shared. Unknown query parameters are ignored rather than
// rejected — once they cannot influence the key they carry no cost, and rejecting
// them would break any caller that appends one (a monitor, a shared link, an
// older frontend we cannot redeploy in lockstep).
const CACHE_ORIGIN = 'https://public-cache.internal';

// How long the edge keeps a built payload. This value is INTERNAL — it is never
// sent to a client, so it does not change what browsers cache. A version bump
// makes a new key, so a stale body can never be served regardless.
const CACHE_RETENTION_SECONDS = 86400;

function cacheKeyFor(action, version) {
  return new Request(`${CACHE_ORIGIN}/${encodeURIComponent(action)}?v=${encodeURIComponent(version)}`);
}

function edgeCache() {
  try { return caches.default || null; } catch (e) { return null; }
}

// The cached JSON TEXT for (action, version), or null when there is none.
// Never touches D1 — used directly by the budget guard, which must not build.
async function readCachedPayload(action, version) {
  try {
    const cache = edgeCache();
    if (!cache) return null;
    const hit = await cache.match(cacheKeyFor(action, version)).catch(() => null);
    return hit ? await hit.text() : null;
  } catch (e) { return null; }
}

// JSON text for (action, version), building it exactly once per version on a miss.
// `build()` returns the DATA OBJECT (and may do its own accounting/snapshot work);
// it only runs on a miss. Degrades to a plain build when the Cache API is absent.
//
// `retentionSeconds` is how long the EDGE keeps this entry — never sent to a client.
// It is a parameter because a payload keyed on a time bucket (popups, below) must
// not sit in the cache for a day after its bucket can no longer be requested.
async function cachedPayload(ctx, action, version, build, retentionSeconds = CACHE_RETENTION_SECONDS) {
  const cached = await readCachedPayload(action, version);
  if (cached !== null) return cached;

  const body = JSON.stringify(await build());
  const cache = edgeCache();
  if (cache) {
    try {
      const stored = new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${retentionSeconds}`,
        },
      });
      const put = cache.put(cacheKeyFor(action, version), stored);
      if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
    } catch (e) { /* caching is best-effort — never fail the response */ }
  }
  return body;
}

// The two client-facing cache policies, unchanged in value from before this
// refactor — only where they are attached moved (per response, not per cache
// entry). `IMMUTABLE_CC` is safe ONLY on a URL that carries the current ?v=.
const IMMUTABLE_CC = 'public, max-age=31536000, immutable';
// Fresh for 30s, then the edge may serve this copy instantly for up to a day
// while it revalidates in the background. This smooths the cliff right after a
// version bump, when every open tab's ?v= goes stale at once.
const REVALIDATE_CC = 'public, max-age=30, stale-while-revalidate=86400';

// ============ POPUPS EXPIRE BY THE CLOCK, NOT BY THE DATA VERSION ============
//
// audit PUB-BE-04. Every other payload here is a pure function of the data version:
// nothing but an admin edit can change the right answer, an edit bumps the version,
// and a new version is a new URL — which is what makes `immutable` correct for them.
//
// `activePopups` is not like that. Its answer depends on `start_at` / `end_at`
// versus NOW, so it changes on a schedule with no write anywhere to bump anything.
// It was nevertheless served with `max-age=31536000, immutable` whenever the caller
// passed the current `?v=`, and the ETag was `activePopups-v<version>`, which does
// not change with time either. So:
//
//   * a popup scheduled to open tomorrow was answered "no popups" today, and that
//     answer was cached in the visitor's browser FOR A YEAR — the popup simply never
//     appeared for anyone who visited before it opened, and
//   * a popup that ended last night stayed cached as visible, and a revalidation
//     could not dislodge it either, because the unchanged ETag returned 304.
//
// Scheduling a popup is the entire point of the feature, so this is the feature
// being broken by its own cache. Correctness here means the cache must be able to
// expire on time.
//
// The fix is a BOUNDED TIME BUCKET folded into the cache identity: the edge key, the
// ETag and the client `max-age` are all derived from `floor(now / POPUP_BUCKET)`.
// One bucket is built once (per version, per colo) and everything inside it is a
// cache hit; when the bucket rolls over, the key and the ETag both change, so the
// edge misses and a revalidation cannot answer 304 with yesterday's popup set.
//
// Why a bucket rather than a TTL computed to the next `start_at`/`end_at` boundary:
// the boundary is only known AFTER building the payload, so a cache HIT — the case
// that must stay cheap — would have no idea when its own answer expires. The bucket
// is derived from the clock alone, so hit and miss agree without reading anything.
//
// The trade is stated plainly: a popup can be up to POPUP_BUCKET_SECONDS late to
// appear or disappear. Against a payload that could previously be a YEAR wrong, one
// minute is a rounding error, and the cost is one rebuild per minute per colo (two
// small queries) instead of one per year.
const POPUP_BUCKET_SECONDS = 60;

// Kept out of the cache for good after two buckets: an old bucket's key can never
// be requested again, so a day-long retention would only occupy the cache.
const POPUP_CACHE_RETENTION_SECONDS = POPUP_BUCKET_SECONDS * 2;

// The bucket is folded into the version component of the cache key and the ETag, so
// no new key format and no second cache scheme is introduced (PUB-BE-01 keeps one
// canonical key per action: still derived from nothing the caller controls).
function popupCacheVersion(version, nowMs) {
  return `${version}.t${Math.floor(nowMs / (POPUP_BUCKET_SECONDS * 1000))}`;
}

// Expire exactly when the bucket does, so every client converges on the same
// boundary instead of each holding its own offset window. Ranges 1..POPUP_BUCKET
// SECONDS, never 0 — a `max-age=0` would make each visitor revalidate constantly.
//
// No `immutable` and no `stale-while-revalidate`: both mean "you may keep showing
// this after it expires", which is the defect being fixed.
function popupCacheControl(nowMs) {
  const remaining = POPUP_BUCKET_SECONDS - (Math.floor(nowMs / 1000) % POPUP_BUCKET_SECONDS);
  return `public, max-age=${remaining}`;
}

function payloadResponse(body, cors, etag, cacheControl) {
  return new Response(body, { headers: { ...cors, ETag: etag, 'Cache-Control': cacheControl } });
}

// True when the client already holds this exact version (If-None-Match matches).
function clientHasCurrent(request, etag) {
  const inm = request.headers.get('If-None-Match');
  if (!inm) return false;
  // A client/CDN may send a comma-separated list; match any token.
  return inm.split(',').some(t => t.trim() === etag);
}

// ============ HEALTH: LIVENESS vs READINESS (audit PUB-BE-03) ============
//
// `GET ?health=1` did SIX D1 round-trips (`SELECT 1` per binding) plus a KV read,
// on EVERY call, and it sits deliberately before the rate limiter so a monitor
// cannot throttle itself. That combination is the problem:
//
//   * A monitor polling every 30s spends ~17,000 D1 round-trips a day on a
//     question — "is the Worker running?" — that needs none, and anyone can
//     multiply that at will because the endpoint is anonymous and unthrottled. The
//     D1 quota is shared with the management API, so the health check could help
//     cause the outage it exists to detect.
//   * It answered an anonymous caller with RAW D1 error text
//     (`'error: ' + e.message`), which is exactly where SQLite echoes table names,
//     column names and database identifiers.
//   * One boolean covered two different questions. A monitor needs liveness ("is
//     this process up?"); an operator needs readiness ("can it reach its
//     dependencies?"). Fusing them means a slow database makes the Worker itself
//     look dead, and the cheap question cannot be asked cheaply.
//
// So they are split:
//
//   `?health=1`               liveness. NO I/O whatsoever — binding presence is a
//                             synchronous property of `env`. This is what a monitor
//                             should poll.
//   `?health=1&deep=1`        readiness. Probes the dependencies, but the result is
//   (or `?health=ready`)      cached at the edge for READINESS_TTL_SECONDS and the
//                             per-IP limiter applies, so a flood cannot multiply
//                             the probes. Full per-binding detail (including error
//                             text) ONLY for a caller holding HEALTH_TOKEN;
//                             everyone else gets states without messages. The
//                             messages always go to the error log, where they are
//                             useful and not public.
const WORKER_NAME = 'chhath-public-api';

// Without these the portal cannot serve its core payload at all.
const REQUIRED_BINDINGS = ['DB_CORE', 'DB_COLLECTIONS', 'DB_LOANS_EXPENSES', 'DB_FILE_INDEX'];

// Degraded, not fatal: the portal still renders, but a feature is silently off.
// (A missing DB_MISC makes every popup disappear — getActivePublicPopups returns []
// by design — and a missing KV disables the rate limiter and the D1 budget guard,
// both of which fail open. All invisible in normal responses, which is why they
// belong in a health check rather than a log line nobody reads.)
const OPTIONAL_BINDINGS = [
  ['DB_MISC', 'popups will not appear'],
  ['DB_LOGS', 'public errors are not recorded'],
];

const READINESS_TTL_SECONDS = 60;

// Liveness: is this Worker running and completely configured? Pure function of
// `env` — no database, no KV, no cache, no awaits.
function livenessReport(env) {
  const missingRequired = REQUIRED_BINDINGS.filter((b) => !env || !env[b]);
  const live = missingRequired.length === 0;
  return {
    // `status` is kept for the monitors already watching this endpoint.
    status: live,
    healthy: live,
    check: 'liveness',
    worker: WORKER_NAME,
    // Binding NAMES are in the committed wrangler.toml, so listing the missing
    // ones tells an attacker nothing new — unlike a D1 error message.
    missingRequired,
  };
}

// One dependency probe. Returns a state plus the raw message, which the caller
// decides whether to expose.
async function probeBinding(db, label) {
  if (!db) return { state: 'missing', message: '' };
  try {
    await db.prepare('SELECT 1 AS ok').first();
    return { state: 'ok', message: '' };
  } catch (e) {
    return { state: 'error', message: `${label}: ${((e && e.message) || 'unknown').toString().slice(0, 200)}` };
  }
}

// Readiness: can the Worker reach its dependencies? Probes run in PARALLEL (they
// were sequential, so the endpoint's latency was the sum of six round-trips).
async function readinessReport(env) {
  const required = await Promise.all(REQUIRED_BINDINGS.map((b) => probeBinding(env && env[b], b)));
  const optional = await Promise.all(OPTIONAL_BINDINGS.map(([b]) => probeBinding(env && env[b], b)));

  const kv = pubKv(env);
  let kvProbe = { state: 'missing', message: '' };
  if (kv) {
    try {
      await kv.get('pub:healthcheck:probe'); // a missing key is still a healthy KV
      kvProbe = { state: 'ok', message: '' };
    } catch (e) {
      kvProbe = { state: 'error', message: `KV: ${((e && e.message) || 'unknown').toString().slice(0, 200)}` };
    }
  }

  const checks = {};
  const messages = [];
  REQUIRED_BINDINGS.forEach((b, i) => {
    checks[b] = { state: required[i].state, required: true };
    if (required[i].message) messages.push(required[i].message);
  });
  OPTIONAL_BINDINGS.forEach(([b, consequence], i) => {
    checks[b] = { state: optional[i].state, required: false, consequence };
    if (optional[i].message) messages.push(optional[i].message);
  });
  checks.KV_PUBLIC = {
    state: kvProbe.state,
    required: false,
    consequence: 'rate limiting and the D1 budget guard are DISABLED (both fail open)',
    ...(kvProbe.state === 'ok' && env && !env.KV_PUBLIC ? { note: 'via the legacy KV_SESSIONS fallback — see wrangler.toml' } : {}),
  };
  if (kvProbe.message) messages.push(kvProbe.message);

  // Only a REQUIRED dependency failing makes this not ready. A degraded feature
  // must not page someone at 2am, but it must be visible.
  const ready = REQUIRED_BINDINGS.every((b) => checks[b].state === 'ok');
  const degraded = Object.values(checks).some((c) => !c.required && c.state !== 'ok');

  return { ready, degraded, checks, messages, checkedAt: new Date().toISOString() };
}

// Readiness is cached in the EDGE cache (free, unlimited writes) rather than KV:
// a 60s KV-backed throttle would cost up to 1440 writes a day against a ~1000/day
// budget this file already treats as a scarce resource. The key is a time bucket,
// so it expires by construction.
function readinessCacheKey() {
  const bucket = Math.floor(Date.now() / (READINESS_TTL_SECONDS * 1000));
  return new Request(`${CACHE_ORIGIN}/readiness?t=${bucket}`);
}

async function cachedReadinessReport(env, ctx) {
  const cache = edgeCache();
  if (cache) {
    const key = readinessCacheKey();
    const hit = await cache.match(key).catch(() => null);
    if (hit) {
      try { return { ...JSON.parse(await hit.text()), cached: true }; } catch (e) { /* fall through and re-probe */ }
    }
    const report = await readinessReport(env);
    try {
      const stored = new Response(JSON.stringify(report), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${READINESS_TTL_SECONDS}` },
      });
      const put = cache.put(key, stored);
      if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
    } catch (e) { /* best effort */ }
    return { ...report, cached: false };
  }
  return { ...(await readinessReport(env)), cached: false };
}

// Constant-time over the token's characters, so the response time cannot be used
// to learn how much of a guess was correct. A length mismatch is rejected up front,
// which reveals the length only — not the content.
function secretsMatch(a, b) {
  const x = (a || '').toString();
  const y = (b || '').toString();
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// Full readiness detail requires HEALTH_TOKEN (`wrangler secret put HEALTH_TOKEN`),
// sent as the `X-Health-Token` header — or `?token=` for monitors that cannot set
// headers, at the usual cost of appearing in access logs. With no token configured
// nobody gets the detail: an unset secret must not mean "open to everyone".
function readinessAuthorized(request, url, env) {
  const expected = (env && env.HEALTH_TOKEN ? env.HEALTH_TOKEN.toString() : '').trim();
  if (!expected) return false;
  const provided = (request.headers.get('X-Health-Token') || url.searchParams.get('token') || '').trim();
  return secretsMatch(provided, expected);
}

// ============ ONE METHOD PER ACTION (audit PUB-BE-02) ============
//
// Routing was `if (action === 'x' && request.method === 'POST')` for the two write
// actions and `if (action === 'x')` — no method check at all — for every read. So:
//
//   * `POST ?action=portalData` ran the full nine-scan build. Worse, it could not
//     be cached: the Cache API refuses a non-GET key, the failure was swallowed by
//     the best-effort try/catch, and the response was returned uncached. Every
//     single POST was therefore a fresh D1 build — an unauthenticated way to spend
//     the D1 daily quota that this Worker shares with the management API, with the
//     edge cache unable to absorb any of it.
//   * `PUT` / `DELETE` / `PATCH` on a read action behaved like GET, so a
//     misconfigured client or scanner silently got data back on a verb the API
//     does not implement.
//   * `GET ?action=logError` fell through to a generic `400 Invalid Request`,
//     which tells a caller nothing about what it did wrong.
//
// One table is now the single source of truth, and it drives BOTH the rejection
// (`405` with a correct `Allow` header, per RFC 9110) and the preflight's
// `Access-Control-Allow-Methods`, so the two can no longer disagree.
const ACTION_METHODS = {
  // Reads. GET only: these are cacheable payloads, and a cacheable payload must
  // be reachable by exactly one method or the cache is bypassable.
  dataVersion: ['GET'],
  publicGetSeo: ['GET'],
  portalData: ['GET'],
  summary: ['GET'],
  activePopups: ['GET'],
  // The two blessed writes (see the WRITE EXCEPTION notes above).
  logError: ['POST'],
  savePushSubscription: ['POST'],
};

// No ?action= at all: the health probe (`GET ?health=1`) and the generic 400.
const ROOT_METHODS = ['GET'];

// The methods an action accepts, or null when the action itself is unknown.
function methodsFor(action) {
  if (!action) return ROOT_METHODS;
  return Object.prototype.hasOwnProperty.call(ACTION_METHODS, action) ? ACTION_METHODS[action] : null;
}

// `Allow` / `Access-Control-Allow-Methods` always include OPTIONS — every endpoint
// answers a preflight.
function allowHeaderFor(methods) {
  return [...methods, 'OPTIONS'].join(', ');
}

// CORS: if ALLOWED_ORIGINS (comma-separated exact origins) is configured, echo
// back the caller's Origin only when it's on the list; otherwise fall back to
// '*' so an un-configured deployment behaves exactly as before. This is a
// read-only public portal, so '*' is a reasonable default here, but the option
// lets an operator lock it down.
function corsOriginFor(request, env) {
  const configured = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.toString() : '').trim();
  if (!configured) return '*'; // read-only public portal — wildcard is a fine default here
  const list = configured.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('*')) return '*';
  const origin = (request.headers.get('Origin') || '').trim();
  // Unknown origin -> null (header omitted) rather than echoing list[0] (audit 1.5).
  return origin && list.includes(origin) ? origin : null;
}

// ============ THE TWO WRITE PATHS GET AN AUTHENTICITY CHECK ============
//
// audit PUB-BE-06. `logError` and `savePushSubscription` are the only writes on this
// Worker, they are anonymous by necessity, and they had no authenticity control of any
// kind. The mistake worth naming is the assumption that CORS was one:
//
//   **CORS does not stop a request. It stops the caller READING the response.**
//
// A cross-origin `POST` still arrives and is still executed; the browser only refuses
// to hand the *reply* to the calling script. For a write, the reply is not the point —
// the row is. And a `POST` with `Content-Type: text/plain` is a CORS *simple request*,
// so it does not even get a preflight for the origin allow-list to reject. So:
//
//   * any page on the internet, or any script anywhere, could insert rows into
//     `error_log` — the table the committee reads to find out whether the public site
//     is broken. Polluting it is enough to hide a real fault, and each insert spends
//     the D1 write quota shared with the management API.
//   * any caller could insert or REACTIVATE a `push_subscriptions` row
//     (`ON CONFLICT … active = 1`), so a subscription a visitor had turned off could
//     be switched back on by a third party, and the table could be filled with
//     endpoints nobody consented to.
//   * `logError` answered `200` even when the write failed, so a broken logger looked
//     exactly like a working one.
//
// Four controls, cheapest first, all applied BEFORE the body is read:
//
//   1. Content-Type MUST be application/json. This is not decoration: it makes the
//      request non-simple, which FORCES a preflight, which is what gives the origin
//      allow-list below any power at all over a browser caller.
//   2. Origin. When ALLOWED_ORIGINS is configured the Origin must be on it — the
//      strong control. When it is NOT configured, a write must still carry SOME
//      Origin: every browser sets it on a cross-origin POST, so this costs a real
//      visitor nothing while rejecting the trivial scripted flood that sets none.
//      This is a floor, not a substitute — see the note in wrangler.toml.
//   3. A hard body-size cap, checked against Content-Length first and then against
//      the bytes actually read, so a lying or absent header cannot get past it.
//   4. A shape check per action, so an empty or junk body is rejected instead of
//      being written as a row that means nothing.
//
// Deliberately NOT added: a challenge/nonce endpoint. It would mean a second
// round-trip and a KV write per opt-in, against the ~1,000/day budget this file
// already treats as scarce, and it cannot authenticate an anonymous visitor either —
// anything the page can fetch, a script can fetch. The controls above raise the cost
// of abuse without pretending to solve attribution.
const WRITE_MAX_BYTES = { logError: 8 * 1024, savePushSubscription: 4 * 1024 };

const JSON_CONTENT_TYPE = /^application\/json\s*(;.*)?$/i;

// A rejection carries the reason in `code` so the handler can pick the right status.
// The messages are deliberately generic — a caller does not need to be taught which
// control it tripped.
function checkWriteRequest(request, env, action) {
  const contentType = (request.headers.get('Content-Type') || '').trim();
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    return { ok: false, status: 415, message: 'Send application/json.' };
  }

  const origin = (request.headers.get('Origin') || '').trim();
  const configured = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.toString() : '').trim();
  const list = configured.split(',').map(s => s.trim()).filter(Boolean);
  if (list.length && !list.includes('*')) {
    if (!origin || !list.includes(origin)) {
      return { ok: false, status: 403, message: 'This origin may not write here.' };
    }
  } else if (!origin) {
    // Unconfigured deployment: the floor described above.
    return { ok: false, status: 403, message: 'This origin may not write here.' };
  }

  const max = WRITE_MAX_BYTES[action] || 4 * 1024;
  const declared = parseInt(request.headers.get('Content-Length') || '', 10);
  if (Number.isFinite(declared) && declared > max) {
    return { ok: false, status: 413, message: 'Request body is too large.' };
  }
  return { ok: true, maxBytes: max };
}

// Reads the body with the cap enforced on the BYTES, not on a header a caller
// controls. Returns `{ ok, value }` or `{ ok: false, status }`.
async function readJsonBody(request, maxBytes) {
  let text;
  try {
    text = await request.text();
  } catch (e) {
    return { ok: false, status: 400, message: 'Could not read the request body.' };
  }
  // A JS string is UTF-16; the cap is about transferred bytes, so measure them.
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, status: 413, message: 'Request body is too large.' };
  }
  if (!text.trim()) return { ok: false, status: 400, message: 'Request body is empty.' };
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    // Previously swallowed: an unparseable body became `{}` and was written as a row
    // with no message, indistinguishable from a real error with no message.
    return { ok: false, status: 400, message: 'Request body is not valid JSON.' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, status: 400, message: 'Request body must be a JSON object.' };
  }
  return { ok: true, value };
}

const writeRejection = (cors, status, message) => new Response(
  JSON.stringify({ success: false, status: false, message }),
  { status, headers: { ...cors, 'Cache-Control': 'no-store' } }
);

// A report with no message is not a report. Everything else is optional, and a
// non-string where a string belongs is a junk body rather than something to coerce.
function validateErrorReport(body) {
  const isStr = (v) => v === undefined || v === null || typeof v === 'string';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return { ok: false, message: 'An error report needs a message.' };
  if (!isStr(body.page) || !isStr(body.stack)) {
    return { ok: false, message: 'page and stack must be strings.' };
  }
  if (body.context !== undefined && body.context !== null
      && typeof body.context !== 'string' && typeof body.context !== 'object') {
    return { ok: false, message: 'context must be a string or an object.' };
  }
  return { ok: true };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const corsOrigin = corsOriginFor(request, env);
    const cors = { 'Content-Type': 'application/json' };
    if (corsOrigin) {
      cors['Access-Control-Allow-Origin'] = corsOrigin;
      if (corsOrigin !== '*') cors['Vary'] = 'Origin';
    }

    // Preflight now advertises the methods THIS action actually accepts, from the
    // same table that enforces them below — it used to promise 'GET, POST' for
    // everything, including read-only endpoints that reject POST.
    if (request.method === 'OPTIONS') {
      const allow = allowHeaderFor(methodsFor(action) || ROOT_METHODS);
      return new Response(null, {
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': allow,
          'Access-Control-Allow-Headers': 'Content-Type',
          // Let the browser reuse this preflight for a day instead of sending one
          // before every logError / savePushSubscription POST.
          'Access-Control-Max-Age': '86400',
          Allow: allow,
        },
      });
    }

    // ---- Method enforcement (audit PUB-BE-02) ----
    //
    // Deliberately the FIRST thing after the preflight: a request on a verb this
    // API does not implement must cost nothing — no KV read for the rate limiter,
    // no D1 probe from the health check, and above all no portal build.
    const allowedMethods = methodsFor(action);
    if (allowedMethods === null) {
      // Unknown action. Answered here rather than after the routing chain so an
      // unknown action can never reach a handler or a cache lookup.
      return new Response(
        JSON.stringify({ status: false, message: 'Invalid Request' }),
        { status: 400, headers: { ...cors, 'Cache-Control': 'no-store' } }
      );
    }
    if (!allowedMethods.includes(request.method)) {
      return new Response(
        JSON.stringify({
          status: false,
          message: `${action || 'This endpoint'} accepts ${allowedMethods.join(', ')} only.`,
        }),
        {
          status: 405,
          headers: { ...cors, Allow: allowHeaderFor(allowedMethods), 'Cache-Control': 'no-store' },
        }
      );
    }

    // ---- Health (audit M-36 / M-37, reworked by PUB-BE-03; see the helpers) ----
    //
    // M-36: an uptime monitor pointed at `/` got `{"status":false,"message":"Invalid
    // Request"}` with HTTP 400, which most monitors read as DOWN — so the only way
    // to watch the public portal was to watch something that always looked broken.
    // mgmt has had `GET ?health=1` since config.js; this is the same contract.
    //
    // M-37: nothing validated the bindings, and a partially-bound deployment serves
    // happily and silently WRONG.
    //
    // LIVENESS stays deliberately BEFORE the rate limiter — a monitor polling every
    // minute must not be able to rate-limit itself into a false alarm — which is
    // safe precisely because it performs no I/O at all.
    // Only a ROOT probe (no ?action=) is a health probe — `?action=x&health=1`
    // stays a request for x.
    const healthParam = action ? '' : (url.searchParams.get('health') || '').trim();
    if (healthParam) {
      const wantsReadiness = healthParam === 'ready' || url.searchParams.get('deep') === '1';

      if (!wantsReadiness) {
        const report = livenessReport(env);
        return new Response(JSON.stringify(report), {
          status: report.healthy ? 200 : 503,
          headers: { ...cors, 'Cache-Control': 'no-store' },
        });
      }

      // READINESS does I/O, so unlike liveness it is rate-limited (its own bucket,
      // so it cannot starve the portal's) on top of the 60s edge-cached result.
      const probeIp = request.headers.get('CF-Connecting-IP') || '';
      if (probeIp && await pubRateLimited(env, probeIp, 'health:ready')) {
        return new Response(
          JSON.stringify({ status: false, check: 'readiness', message: 'Too many readiness probes. Please try again in a little while.' }),
          { status: 429, headers: { ...cors, 'Cache-Control': 'no-store' } }
        );
      }

      const report = await cachedReadinessReport(env, ctx);

      // The probe messages are the operator's real diagnostic, so they are recorded
      // where an operator can read them instead of being handed to the internet.
      // Only on a fresh probe — a cached report was already logged.
      if (report.messages.length && !report.cached) {
        const logging = logPublicError(
          env, 'public-backend', 'health:readiness',
          `readiness probe failed: ${report.messages.length} dependency error(s)`,
          '', JSON.stringify({ errors: report.messages.slice(0, 6) }), ''
        );
        if (ctx && ctx.waitUntil) ctx.waitUntil(logging);
      }

      const authorized = readinessAuthorized(request, url, env);
      const body = {
        status: report.ready,
        healthy: report.ready,
        ready: report.ready,
        degraded: report.degraded,
        check: 'readiness',
        worker: WORKER_NAME,
        checkedAt: report.checkedAt,
        cached: report.cached,
        checks: report.checks,
      };
      if (authorized) {
        body.errors = report.messages;
      } else if (report.messages.length) {
        // States yes, database internals no.
        body.detail = 'redacted — send the HEALTH_TOKEN in an X-Health-Token header for error detail; the messages are in error_log';
      }

      return new Response(JSON.stringify(body), {
        status: report.ready ? 200 : 503,
        headers: { ...cors, 'Cache-Control': 'no-store' },
      });
    }

    // Hardening A: per-IP rate limit (public, unauthenticated). A real viewer
    // makes a handful of requests per page load; a flood script makes hundreds.
    // Capping per IP narrows how fast anyone can burn the shared D1 daily quota.
    // Fails open, so it can never take the portal down on its own.
    const edgeIp = request.headers.get('CF-Connecting-IP') || '';
    if (edgeIp && await pubRateLimited(env, edgeIp, action || 'root')) {
      return new Response(
        JSON.stringify({ status: false, message: 'Too many requests. Please try again in a little while.' }),
        { status: 429, headers: { ...cors, 'Cache-Control': 'no-store' } }
      );
    }

    // The public frontend POSTs its own JS errors here (window.onerror /
    // unhandledrejection / failed data load) so the committee can actually see
    // when the public site is broken.
    // The method is guaranteed by ACTION_METHODS above — checking it again here
    // would be a second source of truth that can drift from the table.
    if (action === 'logError') {
      // audit PUB-BE-06 — see the WRITE PATHS note above. Every check here runs
      // before the body is read, and before any D1 work.
      const guard = checkWriteRequest(request, env, 'logError');
      if (!guard.ok) return writeRejection(cors, guard.status, guard.message);
      const parsed = await readJsonBody(request, guard.maxBytes);
      if (!parsed.ok) return writeRejection(cors, parsed.status, parsed.message);
      const body = parsed.value;

      const shape = validateErrorReport(body);
      if (!shape.ok) return writeRejection(cors, 400, shape.message);

      // Server-observed edge IP drives the per-IP rate limit (audit 1.3) — the
      // client cannot forge it.
      const edgeIp = request.headers.get('CF-Connecting-IP') || '';
      const res = await logPublicError(
        env, 'public-frontend', body.page, body.message, body.stack, body.context, edgeIp
      );
      // The status now tells the truth. This used to answer 200 whether the row was
      // written, rate-limited or lost, so a logger that had stopped working looked
      // exactly like one that was fine.
      const status = res && res.rateLimited ? 429 : (res && res.success ? 200 : 503);
      return new Response(JSON.stringify(res), { headers: { ...cors, 'Cache-Control': 'no-store' }, status });
    }

    // A visitor opting in to notifications on the portal. Upserts one row into
    // push_subscriptions — see the "WRITE EXCEPTION #2" note above. Already
    // covered by the per-IP rate limit a few lines up.
    if (action === 'savePushSubscription') {
      const guard = checkWriteRequest(request, env, 'savePushSubscription');
      if (!guard.ok) return writeRejection(cors, guard.status, guard.message);
      const parsed = await readJsonBody(request, guard.maxBytes);
      if (!parsed.ok) return writeRejection(cors, parsed.status, parsed.message);

      const res = await savePushSubscription(env, parsed.value, request.headers.get('User-Agent') || '');
      // A rejected subscription is the caller's fault (400); a write that failed is
      // ours (503). They were both 400, which told an operator nothing.
      const status = res && res.success ? 200 : (res && res.invalid ? 400 : 503);
      return new Response(JSON.stringify(res), {
        headers: { ...cors, 'Cache-Control': 'no-store' },
        status
      });
    }

    // Every read path is wrapped now — previously a single D1 hiccup took the whole
    // Worker down with a 1101 and nothing recorded anywhere.
    try {
      // ---- dataVersion: the ONE tiny call every page makes on load ----
      //
      // Returns just the current data version. The frontend reads this first,
      // then requests portalData/activePopups with `?v=<version>`. Those
      // version-keyed URLs get a long immutable CDN cache (below), so as long as
      // the version is unchanged the big payloads are served straight from
      // Cloudflare's edge — the Worker/DB are not touched at all. Only this
      // lightweight version ping reaches the Worker on a refresh.
      //
      // Kept essentially uncacheable (short max-age) so a version bump is picked
      // up almost immediately. It's a single-row read, so it's cheap.
      if (action === 'dataVersion') {
        const version = await getDataVersion(env);
        if (version === null) return versionUnavailable(env, cors, action);
        return new Response(JSON.stringify({ v: version }), {
          headers: { ...cors, 'Cache-Control': 'no-cache' },
        });
      }

      // ---- publicGetSeo: link-preview / SEO settings for the build step ----
      //
      // The public frontend's build.mjs calls this at DEPLOY time to bake the
      // Superadmin-managed title/description/keywords/image into index.html.
      // It reads only the four public presentation fields from portal_settings
      // (a handful of tiny single-row reads) and NEVER exposes the deploy-hook
      // URLs. Not called by browsers on a normal page load, so a short cache is
      // fine; a rebuild picks up fresh values immediately regardless.
      if (action === 'publicGetSeo') {
        const seo = await getPublicSeoSettings(env);
        return new Response(JSON.stringify({ status: true, seo }), {
          headers: { ...cors, 'Cache-Control': 'no-cache' },
        });
      }

      if (action === 'portalData') {
        const version = await getDataVersion(env);
        if (version === null) return versionUnavailable(env, cors, action);
        const requestedV = (url.searchParams.get('v') || '').trim();

        // Hardening C: if today's D1 read budget is spent, do NOT build fresh from
        // D1. Serve the cached copy for this version if we have one; otherwise ask
        // the caller to retry shortly. This protects the shared D1 quota so mgmt
        // admins keep working even under a public flood. (A genuine data change
        // still gets served once the next day resets, or from an existing cache.)
        if (await d1BudgetExceeded(env)) {
          const cachedOnly = await readCachedPayload('portalData', version);
          if (cachedOnly !== null) {
            // Keep the edge serving this cached copy WITHOUT touching D1 while the
            // daily budget is spent.
            return payloadResponse(cachedOnly, cors, etagFor('portalData', version), REVALIDATE_CC);
          }
          // No edge cache for this version -> serve the last-known-good snapshot
          // (real data, marked stale) instead of failing, so the public site keeps
          // showing something even with D1 out of quota.
          const snap = await serveSnapshot(env, cors);
          if (snap) return snap;
          return new Response(
            JSON.stringify({ status: false, message: 'The portal is busy right now. Please try again in a little while.' }),
            { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } }
          );
        }

        // Any fresh D1 build below is wrapped so that if D1 fails mid-build (e.g.
        // the daily row limit is hit right here), we DETERMINISTICALLY fall back to
        // the last-known-good snapshot (stale) instead of a 500 — regardless of how
        // the promise rejection would otherwise propagate.
        try {
          const etag = etagFor('portalData', version);
          // One build per data version, shared by BOTH paths below — the fast path
          // and the fallback now hit the same canonical cache key instead of each
          // keeping its own copy (audit PUB-BE-01).
          const buildPortal = async () => {
            const data = await getAllPortalData(env);
            await d1BudgetAdd(env, ctx, countPayloadRows(data)); // count the REAL rows this build read
            await maybeSaveSnapshot(env, ctx, version, data); // last-known-good (only writes on version change)
            return data;
          };

          // FAST PATH: the client asked for a specific version (?v=) and it still
          // matches the live version -> a long IMMUTABLE cache is safe, because
          // THAT URL can only ever mean this one version.
          if (requestedV && requestedV === version) {
            const body = await cachedPayload(ctx, 'portalData', version, buildPortal);
            return payloadResponse(body, cors, etag, IMMUTABLE_CC);
          }

          // FALLBACK PATH (no ?v=, or a stale ?v=): ETag revalidation, so
          // old/no-version callers keep working and get a 304 when unchanged. These
          // URLs are NOT version-specific, so they must never be marked immutable.
          if (clientHasCurrent(request, etag)) {
            return new Response(null, {
              status: 304,
              headers: { ...cors, ETag: etag, 'Cache-Control': 'no-cache' },
            });
          }
          const body = await cachedPayload(ctx, 'portalData', version, buildPortal);
          return payloadResponse(body, cors, etag, REVALIDATE_CC);
        } catch (buildErr) {
          // D1 build failed (likely quota exhausted). Serve the last-known-good
          // snapshot if we have one; otherwise re-throw to the outer handler.
          const snap = await serveSnapshot(env, cors);
          if (snap) {
            ctx.waitUntil(logPublicError(env, 'public-backend', 'portalData:snapshot-fallback',
              (buildErr && buildErr.message) || String(buildErr), '', JSON.stringify({ served: 'stale-snapshot' })));
            return snap;
          }
          throw buildErr;
        }
      }

      // ---- summary: tiny per-year AGGREGATES (audit H-5) ----
      //
      // The full H-5 fix is to stop shipping the entire member+finance database to
      // every anonymous visitor. This is the additive, cache-safe first half: a new
      // endpoint that returns only SQL aggregates (SUM/COUNT per year) — a few dozen
      // bytes — for the landing view, instead of every collections/expense/loan ROW.
      //
      // It is ADDITIVE: `portalData` is unchanged and still served, so nothing that
      // depends on it breaks. `summary` reuses the SAME version-keyed cache machinery
      // (cachedPayload / the D1 budget guard), so it gets its own canonical cache
      // key automatically — the working portalData cache path is not touched at all. The frontend prefers `summary` for totals and only
      // falls back to `portalData` for the detailed lists (loaded lazily per tab).
      if (action === 'summary') {
        const version = await getDataVersion(env);
        if (version === null) return versionUnavailable(env, cors, action);
        const requestedV = (url.searchParams.get('v') || '').trim();

        const etag = etagFor('summary', version);

        if (await d1BudgetExceeded(env)) {
          const cachedOnly = await readCachedPayload('summary', version);
          if (cachedOnly !== null) return payloadResponse(cachedOnly, cors, etag, REVALIDATE_CC);
          // Aggregates are non-critical for a first paint; an empty summary is a safe
          // fallback (the frontend still has portalData/snapshot for the real data).
          return new Response(JSON.stringify({ years: [] }), { headers: { ...cors, 'Cache-Control': 'no-store' } });
        }

        const buildSummary = async () => {
          const data = await getPortalSummary(env);
          await d1BudgetAdd(env, ctx);
          return data;
        };

        if (requestedV && requestedV === version) {
          const body = await cachedPayload(ctx, 'summary', version, buildSummary);
          return payloadResponse(body, cors, etag, IMMUTABLE_CC);
        }

        if (clientHasCurrent(request, etag)) {
          return new Response(null, { status: 304, headers: { ...cors, ETag: etag, 'Cache-Control': 'no-cache' } });
        }
        const body = await cachedPayload(ctx, 'summary', version, buildSummary);
        return payloadResponse(body, cors, etag, REVALIDATE_CC);
      }

      if (action === 'activePopups') {
        const version = await getDataVersion(env);
        if (version === null) return versionUnavailable(env, cors, action);

        // audit PUB-BE-04 — see the POPUPS EXPIRE BY THE CLOCK note above. The cache
        // identity is (data version, time bucket), and one policy serves every
        // caller: there is no longer a branch that hands out `immutable` to a request
        // carrying the current `?v=`, because for this action `?v=` cannot promise
        // that the answer will not change. `?v=` is still accepted and still cannot
        // influence the cache key (PUB-BE-01); it simply no longer buys a year.
        const nowMs = Date.now();
        const cacheVersion = popupCacheVersion(version, nowMs);
        const etag = etagFor('activePopups', cacheVersion);
        const cacheControl = popupCacheControl(nowMs);

        // Hardening C: same budget guard as portalData.
        if (await d1BudgetExceeded(env)) {
          const cachedOnly = await readCachedPayload('activePopups', cacheVersion);
          if (cachedOnly !== null) return payloadResponse(cachedOnly, cors, etag, cacheControl);
          // Popups are non-critical; an empty list is a safe, silent fallback.
          return new Response(JSON.stringify([]), { headers: { ...cors, 'Cache-Control': 'no-store' } });
        }

        // Checked before the build: a client holding this bucket's ETag needs no
        // payload, and after a bucket rollover this can no longer match, so a
        // revalidation cannot be answered with a stale popup set.
        if (clientHasCurrent(request, etag)) {
          return new Response(null, {
            status: 304,
            headers: { ...cors, ETag: etag, 'Cache-Control': cacheControl },
          });
        }

        const body = await cachedPayload(ctx, 'activePopups', cacheVersion, async () => {
          const data = await getActivePublicPopups(env);
          await d1BudgetAdd(env, ctx);
          return data;
        }, POPUP_CACHE_RETENTION_SECONDS);
        return payloadResponse(body, cors, etag, cacheControl);
      }
      // Reached only with no ?action= at all (an unknown action is answered by the
      // method/action check before any handler runs).
      return new Response(JSON.stringify({ status: false, message: 'Invalid Request' }), { headers: cors, status: 400 });
    } catch (err) {
      // Server-originated error (not attacker-driven), so it is logged without an
      // IP cap — a real backend failure must always be recorded.
      const logging = logPublicError(
        env, 'public-backend', action || 'fetch',
        (err && err.message) || String(err), (err && err.stack) || '',
        JSON.stringify({ action, url: url.pathname })
      );
      if (ctx && ctx.waitUntil) ctx.waitUntil(logging); else await logging;
      console.error('[public-worker]', action, err && err.message);

      // Last-resort fallback for portalData: if D1 is out of quota (or otherwise
      // failed) mid-build and we have a last-known-good snapshot, serve that
      // (marked stale) instead of a hard failure, so the public site still shows
      // real data. Only for portalData (the snapshot we keep). Other actions fail
      // as before.
      if (action === 'portalData') {
        const snap = await serveSnapshot(env, cors);
        if (snap) return snap;
      }

      return new Response(
        JSON.stringify({ status: false, message: 'Unable to load data. Please try again in a little while.' }),
        { status: 500, headers: cors }
      );
    }
  },
};
