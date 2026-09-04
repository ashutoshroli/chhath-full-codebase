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
async function tableRows(db, table, columnMap, dropColumns, pickColumns) {
  const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all();
  const allow = pickColumns ? new Set(pickColumns) : null;
  return results.map(r => {
    const out = {};
    for (const [col, val] of Object.entries(r)) {
      if (col === 'id') { out['__rowIndex'] = val; continue; }
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
  users: { id_code: 'ID', name: 'Name', village: 'Village', fathers_name: "Father's Name ", mobile: 'Mobile ', designation: 'Designation', created_by: 'Created By', email: 'Email', whatsapp: 'WhatsApp', name_hindi: 'Name (Hindi)', fathers_name_hindi: "Father's Name (Hindi)", designation_hindi: 'Designation (Hindi)', village_hindi: 'Village (Hindi)' },
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

// Returns the public `users` rows with `email`/`whatsapp` always dropped, and
// `mobile` kept ONLY for people who are committee members in some year (the only
// place the public site shows a mobile). Everyone else has their mobile stripped
// before it ever leaves the Worker (audit 1.2 — data minimization).
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

  const { results } = await env.DB_CORE.prepare('SELECT * FROM users ORDER BY id ASC').all();
  const map = REVERSE_MAPS.users;
  return results.map(r => {
    const isCommittee = committeeIds.has((r.id_code == null ? '' : r.id_code.toString().trim()));
    const out = {};
    for (const [col, val] of Object.entries(r)) {
      if (col === 'id') { out['__rowIndex'] = val; continue; }
      if (col === 'email' || col === 'whatsapp') continue;      // never public
      if (col === 'mobile' && !isCommittee) continue;           // only committee mobiles are public
      const header = map[col] || col;
      out[header] = val === null ? '' : val;
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

const PUB_RL_WINDOW_SECONDS = 60;
const PUB_RL_MAX = 60; // per IP per minute — generous for a real viewer, capping floods
// Estimated D1 rows read per full portal build (8 table scans, sizes vary). We
// budget on the free tier's 5,000,000/day, leaving headroom for mgmt admins.
const D1_DAILY_BUDGET = 4000000;
// A full getAllPortalData build does ~8 unbounded table scans. At 32k members
// the users + collections scans ALONE are tens of thousands of rows, so the old
// flat 2000 estimate wildly UNDER-counted and the budget guard would let far
// more than 5M real reads through before tripping. Estimate conservatively high
// (better to serve from cache slightly early than to blow the shared D1 quota).
const D1_ROWS_PER_BUILD = 60000; // conservative over-estimate per full build (~32k users + collections + others)

// KV WRITE DISCIPLINE (audit): this limiter used to do a KV PUT on EVERY allowed
// request. KV free tier is ~1000 writes/day and is SHARED with the mgmt worker,
// so at festival scale (tens of thousands of requests) it blew the KV write
// quota in minutes — after which this limiter AND the D1 budget counter (both
// KV-backed) started failing, and they fail OPEN, disabling the very protection
// meant to shield the shared D1 quota. Two mitigations:
//   1. Most repeat traffic never reaches the Worker at all — the version-keyed
//      edge cache serves it (see edgeCached/versionCached). So the limiter only
//      sees cache-miss/first-touch requests.
//   2. Counting is now SAMPLED: we still READ the counter every time (reads are
//      cheap and have a far higher free quota), but only WRITE ~1 in
//      RL_SAMPLE requests, incrementing by the sample size. Statistically the
//      counter still climbs at the real rate and a sustained flood is caught,
//      while KV WRITES drop ~20x — keeping us comfortably inside the daily
//      write budget. A genuine flood from one IP still trips PUB_RL_MAX.
const RL_SAMPLE = 20;

async function pubRateLimited(env, ip, action) {
  try {
    if (!env || !env.KV_SESSIONS || !ip) return false;
    const bucket = Math.floor(Date.now() / (PUB_RL_WINDOW_SECONDS * 1000));
    const key = `pub:rl:${action}:${ip}:${bucket}`;
    const cur = parseInt((await env.KV_SESSIONS.get(key)) || '0', 10) || 0;
    if (cur >= PUB_RL_MAX) return true;
    // Sampled write: on average one write per RL_SAMPLE requests, each adding
    // RL_SAMPLE to the counter, so the expected value tracks the true count
    // without a write on every hit.
    if (Math.random() < 1 / RL_SAMPLE) {
      await env.KV_SESSIONS.put(key, String(cur + RL_SAMPLE), { expirationTtl: PUB_RL_WINDOW_SECONDS + 5 });
    }
    return false;
  } catch (e) { return false; } // fail open
}

// True when today's estimated D1 reads have crossed the safety budget — callers
// should then serve from cache only and NOT build fresh from D1.
async function d1BudgetExceeded(env) {
  try {
    if (!env || !env.KV_SESSIONS) return false;
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC, matches D1 reset)
    const used = parseInt((await env.KV_SESSIONS.get(`pub:d1reads:${day}`)) || '0', 10) || 0;
    return used >= D1_DAILY_BUDGET;
  } catch (e) { return false; } // fail open
}

// Records that a fresh D1 build just happened (adds the per-build estimate to
// today's counter). Best-effort; TTL ~2 days so the daily key self-expires.
async function d1BudgetAdd(env, ctx) {
  try {
    if (!env || !env.KV_SESSIONS) return;
    const day = new Date().toISOString().slice(0, 10);
    const key = `pub:d1reads:${day}`;
    const used = parseInt((await env.KV_SESSIONS.get(key)) || '0', 10) || 0;
    const put = env.KV_SESSIONS.put(key, String(used + D1_ROWS_PER_BUILD), { expirationTtl: 172800 });
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  } catch (e) { /* best effort */ }
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
const SNAPSHOT_KEY = 'pub:snapshot:portalData';
const SNAPSHOT_META_KEY = 'pub:snapshot:portalData:version';

async function maybeSaveSnapshot(env, ctx, version, dataObj) {
  try {
    if (!env || !env.KV_SESSIONS) return;
    const lastVer = await env.KV_SESSIONS.get(SNAPSHOT_META_KEY);
    if (lastVer === String(version)) return; // snapshot already current for this version — no write
    // TTL was 24h: if the data didn't change for a day (a quiet, non-festival
    // period) the last-known-good snapshot EXPIRED, so a later D1 outage would
    // hit a 503/500 instead of serving stale-but-real data — exactly when the
    // fallback is needed. 30 days keeps the safety net alive through any quiet
    // stretch; it's rewritten (and its TTL refreshed) whenever data changes, and
    // it's only ONE write per real data change, so KV write budget is unaffected.
    const SNAPSHOT_TTL = 2592000; // 30 days
    const writes = Promise.all([
      env.KV_SESSIONS.put(SNAPSHOT_KEY, JSON.stringify(dataObj), { expirationTtl: SNAPSHOT_TTL }),
      env.KV_SESSIONS.put(SNAPSHOT_META_KEY, String(version), { expirationTtl: SNAPSHOT_TTL }),
    ]);
    if (ctx && ctx.waitUntil) ctx.waitUntil(writes); else await writes;
  } catch (e) { /* best effort — snapshotting must never affect the response */ }
}

// Returns a Response built from the last-known-good snapshot (marked stale), or
// null if no snapshot exists. Never touches D1.
async function serveSnapshot(env, cors) {
  try {
    if (!env || !env.KV_SESSIONS) return null;
    const raw = await env.KV_SESSIONS.get(SNAPSHOT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
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
    committee: await tableRows(env.DB_CORE, 'committee_members', REVERSE_MAPS.committee_members),
    collections: await tableRows(env.DB_COLLECTIONS, 'collections', REVERSE_MAPS.collections),
    expenses: await tableRows(env.DB_LOANS_EXPENSES, 'expenses', REVERSE_MAPS.expenses),
    // SECURITY: drop `signature` + `loan_documents` (personal signature image +
    // document links) — the public site never renders them.
    loans: await tableRows(env.DB_LOANS_EXPENSES, 'loans', REVERSE_MAPS.loans, ['signature', 'loan_documents']),
    // SECURITY: drop `guarantor_signature` (personal signature image URL).
    guarantors: await tableRows(env.DB_LOANS_EXPENSES, 'loan_guarantors', REVERSE_MAPS.loan_guarantors, ['guarantor_signature']),
    // `drive_path` is an INTERNAL Drive location ("Generated PDFs/Consents-Loaner/
    // 2026/Consent-CN...pdf") that the public site never renders — it was being
    // shipped to every anonymous visitor for no reason. The portal only needs
    // doc_type/year/record_id (to match a record) and public_link (to download).
    generatedFiles: await tableRows(env.DB_FILE_INDEX, 'generated_files', REVERSE_MAPS.generated_files, ['drive_path']),
    loanConsents: await tableRows(env.DB_LOANS_EXPENSES, 'loan_consents', REVERSE_MAPS.loan_consents, null, LOAN_CONSENTS_PUBLIC_COLS),
  };
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

async function getActivePublicPopups(env) {
  if (!env.DB_MISC) return []; // binding not configured yet — fail closed, not open
  const now = new Date();
  // Was `WHERE active = 1`, which matched '1' but NEVER the 'True' written by the
  // migration — so a popup the admin UI proudly showed as "Active" was never
  // actually served here. Filter in JS with the permissive flag check instead.
  const { results: allPopups } = await env.DB_MISC.prepare(
    'SELECT popup_id, title, roles, active, start_at, end_at FROM popups'
  ).all();
  const popups = allPopups.filter(p => {
    if (!isTruthyFlag(p.active)) return false;
    const rolesList = (p.roles || '').split(',').map(r => r.trim()).filter(Boolean);
    // Only popups explicitly tagged "Public" in mgmt's Popup Management show
    // here — a popup with no roles at all is treated as mgmt-internal-only,
    // so Superadmin must opt a popup into the Public role deliberately.
    if (!rolesList.includes('Public')) return false;
    const start = parseStoredDate(p.start_at);
    const end = parseStoredDate(p.end_at);
    if (start && start > now) return false;
    if (end && end < now) return false;
    return true;
  });
  if (!popups.length) return [];
  const { results: allSlides } = await env.DB_MISC.prepare(
    'SELECT slide_id, popup_id, slide_order, image_url, text, link_url, link_text FROM popup_slides ORDER BY slide_order ASC'
  ).all();
  return popups
    .map(p => ({
      popup_id: p.popup_id,
      title: p.title,
      slides: allSlides
        .filter(s => s.popup_id === p.popup_id)
        // Coalesce NULLs — the migrated slide row has text/link_url/link_text NULL.
        .map(s => ({
          slide_id: s.slide_id,
          slide_order: parseInt(s.slide_order) || 0,
          image_url: s.image_url || '',
          text: s.text || '',
          link_url: s.link_url || '',
          link_text: s.link_text || '',
        })),
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
    if (ip) {
      const windowStart = new Date(Date.now() - PUBLIC_LOG_WINDOW_MS).toISOString();
      const cnt = await env.DB_LOGS.prepare(
        "SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ? AND context LIKE ?"
      ).bind(windowStart, `%"edgeIp":"${ip}"%`).first().catch(() => null);
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
      'INSERT INTO error_log (error_id, source, page, message, stack, context, created_at, reported) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
    ).bind(id, src, pg, msg, clamp(stack, 2000), ctx, new Date().toISOString()).run();
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

async function getDataVersion(env) {
  try {
    if (!env || !env.DB_CORE) return '0';
    const row = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?')
      .bind(DATA_VERSION_KEY).first();
    return (row && row.value != null ? row.value.toString() : '0') || '0';
  } catch (e) {
    return '0';
  }
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

// Edge cache (caches.default) for the version-keyed payloads.
//
// A `Cache-Control: immutable` header alone tells the BROWSER to cache, but a
// Worker response is NOT put on Cloudflare's edge automatically — and Cache
// Rules don't reliably apply to *.workers.dev. So we cache explicitly here: on a
// HIT the big payload is returned without ever reading D1; on a MISS we build it
// and store it under the versioned URL. Because the URL carries ?v=<version>, a
// data change (new version -> new URL) is a fresh key, so a stale body can never
// be served. Keyed on the full request URL (which includes ?v=).
//
// Safe/degrades: if the Cache API is unavailable, build() runs normally.
async function edgeCached(request, ctx, build) {
  let cache;
  try { cache = caches.default; } catch (e) { cache = null; }
  if (!cache) return build();

  const hit = await cache.match(request).catch(() => null);
  if (hit) return hit;

  const res = await build();
  // Only cache a good, cacheable response.
  try {
    const cc = res.headers.get('Cache-Control') || '';
    if (res.status === 200 && /max-age=\d/.test(cc)) {
      const toStore = res.clone();
      if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(request, toStore));
      else await cache.put(request, toStore);
    }
  } catch (e) { /* caching is best-effort — never fail the response */ }
  return res;
}

// Version-keyed edge cache for the FALLBACK path (no ?v= or a stale ?v=).
//
// The fast path (edgeCached) keys on the request URL, which carries the client's
// ?v= — perfect when that version is current. But a request with NO version, or a
// STALE version (every already-open browser/tab in the window right after a data
// change), fell through to a fresh getAllPortalData() — 8 full table scans — on
// EVERY request, with no cache. Under load that overwhelmed D1 (observed: 500s +
// multi-second latency at 200 rps). This keys the payload on the CURRENT LIVE
// version via a synthetic cache URL (independent of whatever ?v= the client sent),
// so all fallback callers share one built copy per version instead of each
// triggering their own 8 scans. Data is always current (key = live version), and
// a version bump makes a new key so a stale body can never be served.
//
// Best-effort: if the Cache API is unavailable, build() just runs (unchanged).
async function versionCached(ctx, cacheName, version, build) {
  let cache;
  try { cache = caches.default; } catch (e) { cache = null; }
  if (!cache) return build();
  // Synthetic, internal key — NOT the client's URL. Same-origin dummy host.
  const key = new Request(`https://public-cache.internal/${cacheName}?v=${encodeURIComponent(version)}`);
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit;
  const res = await build();
  try {
    if (res.status === 200) {
      const toStore = res.clone();
      if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, toStore));
      else await cache.put(key, toStore);
    }
  } catch (e) { /* best effort */ }
  return res;
}

// Reads (does NOT build) the version-keyed cache for a payload — used by the D1
// budget guard: when the daily D1 budget is spent we still want to serve a cached
// copy if one exists, without touching D1. Returns a Response or null. Uses the
// SAME key scheme as versionCached().
async function serveVersionCacheOnly(request, ctx, cacheName, version, cors, etag) {
  try {
    let cache;
    try { cache = caches.default; } catch (e) { cache = null; }
    if (!cache) return null;
    // Try BOTH cache keys a payload could live under:
    //   1) the fast-path edgeCached key = the client's own request URL (carries ?v=)
    //   2) the fallback versionCached key = synthetic internal URL on the live version
    const candidates = [
      request, // fast-path key (request URL)
      new Request(`https://public-cache.internal/${cacheName}?v=${encodeURIComponent(version)}`),
    ];
    for (const key of candidates) {
      const hit = await cache.match(key).catch(() => null);
      if (hit) {
        const body = await hit.text();
        return new Response(body, { headers: { ...cors, ETag: etag, 'Cache-Control': 'public, max-age=30' } });
      }
    }
    return null;
  } catch (e) { return null; }
}

// True when the client already holds this exact version (If-None-Match matches).
function clientHasCurrent(request, etag) {
  const inm = request.headers.get('If-None-Match');
  if (!inm) return false;
  // A client/CDN may send a comma-separated list; match any token.
  return inm.split(',').some(t => t.trim() === etag);
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

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
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
    if (action === 'logError' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) { /* keep the empty object */ }
      // Server-observed edge IP drives the per-IP rate limit (audit 1.3) — the
      // client cannot forge it.
      const edgeIp = request.headers.get('CF-Connecting-IP') || '';
      const res = await logPublicError(
        env, 'public-frontend', body.page, body.message, body.stack, body.context, edgeIp
      );
      return new Response(JSON.stringify(res), { headers: cors, status: res && res.rateLimited ? 429 : 200 });
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
        const requestedV = (url.searchParams.get('v') || '').trim();

        // Hardening C: if today's D1 read budget is spent, do NOT build fresh from
        // D1. Serve the cached copy for this version if we have one; otherwise ask
        // the caller to retry shortly. This protects the shared D1 quota so mgmt
        // admins keep working even under a public flood. (A genuine data change
        // still gets served once the next day resets, or from an existing cache.)
        if (await d1BudgetExceeded(env)) {
          const cachedOnly = await serveVersionCacheOnly(request, ctx, 'portalData', version, cors, etagFor('portalData', version));
          if (cachedOnly) return cachedOnly;
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
          // FAST PATH: the client asked for a specific version (?v=) and it still
          // matches the live version -> return the payload with a long IMMUTABLE
          // cache so Cloudflare's edge caches it and serves every future request
          // for this exact URL without ever hitting the Worker again.
          if (requestedV && requestedV === version) {
            return await edgeCached(request, ctx, async () => {
              const data = await getAllPortalData(env);
              await d1BudgetAdd(env, ctx); // count this fresh D1 build toward today's budget
              await maybeSaveSnapshot(env, ctx, version, data); // last-known-good (only writes on version change)
              return new Response(JSON.stringify(data), {
                headers: {
                  ...cors,
                  ETag: etagFor('portalData', version),
                  // 1 year + immutable: safe because the URL is version-specific.
                  'Cache-Control': 'public, max-age=31536000, immutable',
                },
              });
            });
          }

          // FALLBACK PATH (no ?v=, or a stale ?v=): ETag revalidation as before, so
          // old/no-version callers keep working and get a 304 when unchanged.
          const etag = etagFor('portalData', version);
          if (clientHasCurrent(request, etag)) {
            return new Response(null, {
              status: 304,
              headers: { ...cors, ETag: etag, 'Cache-Control': 'no-cache' },
            });
          }
          // Cache the build on the CURRENT live version so a burst of stale/no-version
          // requests doesn't each run 8 full table scans and overwhelm D1.
          return await versionCached(ctx, 'portalData', version, async () => {
            const data = await getAllPortalData(env);
            await d1BudgetAdd(env, ctx);
            await maybeSaveSnapshot(env, ctx, version, data);
            return new Response(JSON.stringify(data), {
              headers: { ...cors, ETag: etag, 'Cache-Control': 'public, max-age=30' },
            });
          });
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

      if (action === 'activePopups') {
        const version = await getDataVersion(env);
        const requestedV = (url.searchParams.get('v') || '').trim();

        // Hardening C: same budget guard as portalData.
        if (await d1BudgetExceeded(env)) {
          const cachedOnly = await serveVersionCacheOnly(request, ctx, 'activePopups', version, cors, etagFor('activePopups', version));
          if (cachedOnly) return cachedOnly;
          // Popups are non-critical; an empty list is a safe, silent fallback.
          return new Response(JSON.stringify([]), { headers: { ...cors, 'Cache-Control': 'no-store' } });
        }

        if (requestedV && requestedV === version) {
          return edgeCached(request, ctx, async () => {
            const data = await getActivePublicPopups(env);
            await d1BudgetAdd(env, ctx);
            return new Response(JSON.stringify(data), {
              headers: {
                ...cors,
                ETag: etagFor('activePopups', version),
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
          });
        }

        const etag = etagFor('activePopups', version);
        if (clientHasCurrent(request, etag)) {
          return new Response(null, {
            status: 304,
            headers: { ...cors, ETag: etag, 'Cache-Control': 'no-cache' },
          });
        }
        // Same fallback hardening as portalData: cache the build on the current
        // live version so stale/no-version bursts don't each rebuild.
        return versionCached(ctx, 'activePopups', version, async () => {
          const data = await getActivePublicPopups(env);
          await d1BudgetAdd(env, ctx);
          return new Response(JSON.stringify(data), {
            headers: { ...cors, ETag: etag, 'Cache-Control': 'public, max-age=30' },
          });
        });
      }
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
