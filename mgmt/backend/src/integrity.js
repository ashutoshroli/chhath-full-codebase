// ============================================================================
// Data-integrity DETECTION (Superadmin, strictly read-only) — audit Wave 4, PR-33
//
// WHAT THIS IS FOR
//
// Every important business key in this database is an ORDINARY INDEX, not a unique
// constraint: login names, `users.id_code`, `loans.loan_id`, consent ids and tokens,
// and `(collections.year, collections.sl_no)`. Cross-table references — a consent's
// `loan_id`, a collection's `name`, a generated file's `record_id` — are bare TEXT
// columns with no foreign key, and D1 does not enforce `PRAGMA foreign_keys` across
// requests anyway, so a FK would be documentation even if one existed.
//
// The consequence is not theoretical. Three of these have already caused visible
// damage, recorded elsewhere in the tree:
//   * duplicate `users.id_code` from a read-then-write race (see the H-9 comment in
//     crud.js) — "Nothing detected it — there was no unique constraint";
//   * consent rows orphaned by pre-#82 loan deletions, whose consent tokens may
//     still be live (audit H-8);
//   * two `generated_files` rows for one document, after which the public portal's
//     `.find()` returned an arbitrary one (fixed by uq_generated_files_doc_year_record).
//
// The detection queries for a few of these were written down — as SQL COMMENTS, in
// migration/2026-09-05/07, /08 and /10. A commented query is not a check: somebody
// has to remember it exists, paste it into `wrangler d1 execute` against the right
// one of nine databases, and read the output correctly. Nobody did.
//
// So this module makes them runnable, in one call, over every database at once —
// including the checks that CANNOT be expressed as SQL at all, because D1 has no
// cross-database join and the references above span databases.
//
// WHAT THIS IS *NOT*
//
// This module NEVER writes. Every statement is a SELECT. It does not repair, delete,
// re-point or de-duplicate anything, and it deliberately adds no constraint. That
// separation is the point of the audit's staging — detect (this PR), then repair,
// then enforce — because adding a UNIQUE index to a populated table FAILS if the
// duplicates are still there, and repairing rows you have not looked at is how a
// cleanup becomes an incident. Read the report, decide row by row, then enforce.
//
// ON "DUPLICATE" MEANING TWO DIFFERENT THINGS
//
// Most checks here find a violated INVARIANT: two rows share a key the code assumes
// is unique, and one of them is wrong. Those are reported as `severity: 'error'`.
//
// One check — duplicate PEOPLE — is different, and is reported as `severity: 'review'`.
// Two members can genuinely share a name, a father's name and a village. Nothing in
// the data can tell that pair apart from one person entered twice, so this check
// produces candidates for a human to look at, never a defect. PR-34 must NOT put a
// unique index on it. It is here because it was reported from live use: the Add
// Collection picker showed two `Ajay Verma` (see personOption.ts), which the picker
// now disambiguates visually — but nothing detects the underlying duplicate rows,
// and a contribution recorded against the wrong one of two identical rows is
// invisible afterwards.
//
// ON THE ROW CAPS
//
// Each check returns at most SAMPLE_LIMIT findings and sets `truncated` when there
// are more, rather than issuing a second COUNT(*) to report an exact total. That is
// a deliberate trade against a hard platform limit, not laziness: a single Worker
// invocation on the D1 free plan may make only 50 subrequests, and EVERY D1 query
// counts as one (the same constraint lookups.js exists to respect). One query per
// check keeps a full nine-database report comfortably inside that budget; two per
// check would not. An operator who needs exact counts runs the reported SQL by hand
// against the one database that matters — `sql` is included in every finding for
// exactly that reason.
// ============================================================================

import { requireSuperadmin, ValidationError } from './auth.js';

// Findings returned per check before truncation kicks in.
export const SAMPLE_LIMIT = 50;

// Distinct referring values pulled per cross-database check. A reference set larger
// than this is itself worth knowing about, and is reported as `scanTruncated`.
export const SCAN_LIMIT = 2000;

// D1's practical bound on bound parameters per statement is ~100; 90 keeps the same
// margin lookups.js uses.
const CHUNK = 90;

function chunks(arr, size = CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Which of `values` exist in <table>.<column>, as a Set. Existence only, so it
// selects the key column alone — this walks whole reference sets, not the two or
// three ids an app request looks up.
async function existingValues(db, table, column, values) {
  const found = new Set();
  const ids = [...new Set(values)];
  if (!ids.length) return found;
  for (const group of chunks(ids)) {
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT DISTINCT ${column} FROM ${table} WHERE ${column} IN (${placeholders})`)
      .bind(...group)
      .all();
    for (const r of results || []) {
      const v = r[column];
      if (v != null) found.add(v.toString());
    }
  }
  return found;
}

// Distinct non-empty values of a referring column, bounded.
async function distinctRefs(db, table, column) {
  const { results } = await db.prepare(
    `SELECT DISTINCT ${column} AS v FROM ${table}
      WHERE ${column} IS NOT NULL AND TRIM(${column}) <> ''
      LIMIT ${SCAN_LIMIT + 1}`
  ).all();
  const vals = (results || []).map(r => (r.v == null ? '' : r.v.toString().trim())).filter(Boolean);
  return { values: vals.slice(0, SCAN_LIMIT), scanTruncated: vals.length > SCAN_LIMIT };
}

// Runs one grouped/filtered detection SELECT and packages the result. The query must
// already carry its own `LIMIT ?`, bound here to SAMPLE_LIMIT + 1 so truncation is
// detectable without a second statement.
async function detect(db, sql) {
  const { results } = await db.prepare(sql).bind(SAMPLE_LIMIT + 1).all();
  const rows = results || [];
  const truncated = rows.length > SAMPLE_LIMIT;
  return { found: truncated ? SAMPLE_LIMIT : rows.length, truncated, samples: rows.slice(0, SAMPLE_LIMIT) };
}

// ---------------------------------------------------------------------------
// The checks.
//
// `needs` lists the env bindings a check requires. A missing binding makes the check
// UNAVAILABLE — never "passed". A report that silently skips a database it could not
// open is worse than no report, because it reads as a clean bill of health.
// ---------------------------------------------------------------------------

const CHECKS = [
  // ---- duplicates on keys the code treats as unique ----
  {
    id: 'dup_login_name',
    title: 'Two logins share one name',
    kind: 'duplicate',
    severity: 'error',
    needs: ['DB_CORE'],
    // WHY THIS IS THE WORST ONE. login_users.name has only a plain index
    // (idx_login_users_name). Sign-in resolves the account with
    // `SELECT * FROM login_users WHERE name = ? ... LIMIT 1` (auth.js), and
    // verifyToken re-reads `SELECT role FROM login_users WHERE name = ? LIMIT 1` on
    // EVERY authenticated request to catch demotions. With two rows of the same
    // name, "LIMIT 1" picks whichever row SQLite hands back first — so the password
    // that works, and the ROLE that request runs with, are both arbitrary. Two rows
    // named the same where one is a Superadmin is a privilege question, not an
    // untidiness question, which is why `roles` is reported.
    sql: `SELECT name,
                 COUNT(*) AS copies,
                 GROUP_CONCAT(DISTINCT role) AS roles
            FROM login_users
           WHERE name IS NOT NULL AND TRIM(name) <> ''
           GROUP BY name COLLATE NOCASE
          HAVING COUNT(*) > 1
           ORDER BY copies DESC, name
           LIMIT ?`,
    hint: 'Rename or delete the redundant login. Until then the effective role of that name is whichever row D1 returns first.',
  },
  {
    id: 'dup_user_id_code',
    title: 'Two member rows share one USER#### id',
    kind: 'duplicate',
    severity: 'error',
    needs: ['DB_CORE'],
    // The query written as a comment in migration/2026-09-05/07-core-id-uniqueness.sql.
    // id_code is the id every other database refers to a person BY, so a duplicate
    // makes "who contributed this?" unanswerable. Must return zero before 07's
    // partial UNIQUE index (uq_users_id_code) can be applied.
    sql: `SELECT id_code,
                 COUNT(*) AS copies,
                 GROUP_CONCAT(name) AS names
            FROM users
           WHERE id_code IS NOT NULL AND id_code <> ''
           GROUP BY id_code
          HAVING COUNT(*) > 1
           ORDER BY copies DESC, id_code
           LIMIT ?`,
    hint: 'Blocks migration 07 (uq_users_id_code). Re-code the newer row and re-point anything that referenced it.',
  },
  {
    id: 'dup_person',
    title: 'Same name, father and village recorded more than once',
    kind: 'duplicate',
    severity: 'review', // candidates for a human, NOT a violated invariant — see the header.
    needs: ['DB_CORE'],
    sql: `SELECT LOWER(TRIM(name))                        AS name_key,
                 LOWER(TRIM(COALESCE(fathers_name, '')))  AS father_key,
                 LOWER(TRIM(COALESCE(village, '')))       AS village_key,
                 COUNT(*)                                 AS copies,
                 GROUP_CONCAT(id_code)                    AS id_codes
            FROM users
           WHERE name IS NOT NULL AND TRIM(name) <> ''
           GROUP BY name_key, father_key, village_key
          HAVING COUNT(*) > 1
           ORDER BY copies DESC, name_key
           LIMIT ?`,
    hint: 'Review by hand — two people CAN share all three. Never enforce this with a unique index.',
  },
  {
    id: 'dup_collection_sl_no',
    title: 'Two contributions share one receipt number',
    kind: 'duplicate',
    severity: 'error',
    needs: ['DB_COLLECTIONS'],
    // migration/2026-09-05/08-collections-sl-no-uniqueness.sql's commented query,
    // plus what the collision actually MEANS. A receipt number is not a separate
    // column: templates.js builds it as `NCS-<year>-<Sl. No.>`, and the samaan
    // number as `NCS-SAMAAN-<year>-<Sl. No.>`. So a duplicate (year, sl_no) IS a
    // duplicate receipt number — two different contributions, possibly different
    // amounts and different people, printing the same receipt id. That is also why
    // 08 warns to check generated_files: the PDF index is keyed on the row, so the
    // two collide there too (see the orphan_generated_file check).
    sql: `SELECT year,
                 sl_no,
                 'NCS-' || year || '-' || sl_no AS receipt_no,
                 COUNT(*)                       AS copies,
                 GROUP_CONCAT(id)               AS row_ids,
                 GROUP_CONCAT(name)             AS names
            FROM collections
           WHERE year IS NOT NULL AND sl_no IS NOT NULL
           GROUP BY year, sl_no
          HAVING COUNT(*) > 1
           ORDER BY year DESC, sl_no
           LIMIT ?`,
    hint: 'Blocks migration 08. Renumber the later row, then re-issue its receipt/certificate PDF.',
  },
  {
    id: 'dup_loan_id',
    title: 'Two loans share one Loan ID',
    kind: 'duplicate',
    severity: 'error',
    needs: ['DB_LOANS_EXPENSES'],
    // Query 1c from migration/2026-09-05/10-loans-referential-integrity.sql. Consents
    // and guarantors are attached to a loan BY loan_id, so a duplicate silently
    // merges two loans' consent sets: every consent for either loan appears under
    // both, and the accepted/pending/declined counts printed on a consent PDF are
    // then wrong for both. Must be zero before 10's uq_loans_loan_id.
    sql: `SELECT loan_id,
                 COUNT(*)          AS copies,
                 GROUP_CONCAT(id)  AS row_ids,
                 GROUP_CONCAT(year) AS years
            FROM loans
           WHERE loan_id IS NOT NULL AND loan_id <> ''
           GROUP BY loan_id
          HAVING COUNT(*) > 1
           ORDER BY copies DESC, loan_id
           LIMIT ?`,
    hint: 'Blocks migration 10 PART 3 (uq_loans_loan_id) and merges two loans\u2019 consent sets. Re-issue one Loan ID.',
  },
  {
    id: 'dup_consent_id',
    title: 'Two consents share one consent id',
    kind: 'duplicate',
    severity: 'error',
    needs: ['DB_LOANS_EXPENSES'],
    // consent_id is what a consent PDF is filed under in generated_files
    // (`<docType>-<year>-<consent_id>`, docxTemplates.js), and that index has a real
    // UNIQUE constraint. So two consents sharing an id cannot both have a document:
    // the second write hits ON CONFLICT and OVERWRITES the first one's row, and the
    // public portal then shows one person's consent PDF as the other's verified record.
    sql: `SELECT consent_id,
                 COUNT(*)              AS copies,
                 GROUP_CONCAT(id)      AS row_ids,
                 GROUP_CONCAT(loan_id) AS loan_ids,
                 GROUP_CONCAT(status)  AS statuses
            FROM loan_consents
           WHERE consent_id IS NOT NULL AND consent_id <> ''
           GROUP BY consent_id
          HAVING COUNT(*) > 1
           ORDER BY copies DESC, consent_id
           LIMIT ?`,
    hint: 'One consent PDF would overwrite the other in generated_files. Re-issue the newer consent id.',
  },
  {
    id: 'dup_consent_token',
    title: 'One consent link opens more than one consent',
    kind: 'duplicate',
    severity: 'error',
    needs: ['DB_LOANS_EXPENSES'],
    // The token IS the credential: it is the whole of the authorization on the
    // token-gated public consent page, which is why it has only a plain index
    // (idx_loan_consents_token) and is looked up as a single row. Two rows sharing a
    // token means one link resolves to an arbitrary one of two consents — a person
    // could be shown, and could sign, somebody else's. `statuses` is reported because
    // a shared token on a row that is still PENDING is live right now.
    sql: `SELECT token,
                 COUNT(*)                AS copies,
                 GROUP_CONCAT(id)        AS row_ids,
                 GROUP_CONCAT(person_id) AS person_ids,
                 GROUP_CONCAT(status)    AS statuses
            FROM loan_consents
           WHERE token IS NOT NULL AND token <> ''
           GROUP BY token
          HAVING COUNT(*) > 1
           ORDER BY copies DESC
           LIMIT ?`,
    hint: 'Treat as a live credential problem: revoke BOTH rows\u2019 tokens and re-send, do not just delete one row.',
  },

  // ---- orphans within one database ----
  {
    id: 'orphan_consent_loan',
    title: 'Consents attached to a loan that no longer exists',
    kind: 'orphan',
    severity: 'error',
    needs: ['DB_LOANS_EXPENSES'],
    // Query 1a from migration 10 — the audit H-8 case. Loan deletion before #82 left
    // the consent rows behind, and a consent row carries a token that may still be
    // live, so this is not merely tidiness: a link can still open a consent for a
    // loan that is gone. `status` is reported so a still-pending orphan is obvious.
    sql: `SELECT lc.id,
                 lc.consent_id,
                 lc.loan_id,
                 lc.person_id,
                 lc.role,
                 lc.status,
                 CASE WHEN lc.token IS NOT NULL AND lc.token <> '' THEN 1 ELSE 0 END AS has_token
            FROM loan_consents lc
           WHERE lc.loan_id IS NOT NULL AND lc.loan_id <> ''
             AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.loan_id = lc.loan_id)
           ORDER BY lc.id
           LIMIT ?`,
    hint: 'Audit H-8. Revoke any still-live token FIRST, then delete or re-point. Do not blind-delete by status.',
  },
  {
    id: 'orphan_guarantor_loan',
    title: 'Guarantor rows attached to a loan that no longer exists',
    kind: 'orphan',
    severity: 'error',
    needs: ['DB_LOANS_EXPENSES'],
    // Query 1b from migration 10. Must be zero before 10's PART 2 triggers are
    // applied, or a legitimate later write to the same loan_id starts aborting.
    sql: `SELECT lg.id,
                 lg.loan_id,
                 lg.loaner,
                 lg.guarantor,
                 lg.year
            FROM loan_guarantors lg
           WHERE lg.loan_id IS NOT NULL AND lg.loan_id <> ''
             AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.loan_id = lg.loan_id)
           ORDER BY lg.id
           LIMIT ?`,
    hint: 'Blocks migration 10 PART 2 triggers. Delete or re-point before enforcing.',
  },
];

// ---------------------------------------------------------------------------
// Cross-database checks.
//
// These cannot be a SQL file at all — the referring row and the row it refers to
// live in DIFFERENT D1 databases, and D1 has no cross-database query. That is
// precisely why they were never written down as comments alongside the others, and
// why they have gone unchecked: expressing them needs two bindings and a join done
// in the isolate.
// ---------------------------------------------------------------------------

// Every place a `USER####` id is stored outside the users table. None of these is a
// foreign key; each is a bare TEXT column holding an id_code by value.
const PERSON_REFS = [
  { db: 'DB_LOANS_EXPENSES', table: 'loan_consents',    column: 'person_id', means: 'the person asked to consent' },
  { db: 'DB_LOANS_EXPENSES', table: 'loans',            column: 'name',      means: 'the borrower' },
  { db: 'DB_LOANS_EXPENSES', table: 'loan_guarantors',  column: 'loaner',    means: 'the borrower a guarantor stood for' },
  { db: 'DB_LOANS_EXPENSES', table: 'loan_guarantors',  column: 'guarantor', means: 'the guarantor' },
  { db: 'DB_COLLECTIONS',    table: 'collections',      column: 'name',      means: 'the contributor' },
  { db: 'DB_CORE',           table: 'committee_members', column: 'name',     means: 'the committee member' },
];

async function checkPersonRefs(env) {
  const needed = [...new Set(['DB_CORE', ...PERSON_REFS.map(r => r.db)])];
  const missing = needed.filter(b => !env[b]);
  if (missing.length) return { unavailable: missing };

  const samples = [];
  let found = 0;
  let scanTruncated = false;

  for (const ref of PERSON_REFS) {
    const { values, scanTruncated: t } = await distinctRefs(env[ref.db], ref.table, ref.column);
    if (t) scanTruncated = true;
    if (!values.length) continue;
    const present = await existingValues(env.DB_CORE, 'users', 'id_code', values);
    for (const v of values) {
      if (present.has(v)) continue;
      found++;
      if (samples.length < SAMPLE_LIMIT) {
        samples.push({ table: ref.table, column: ref.column, missing_id_code: v, means: ref.means });
      }
    }
  }

  return {
    found,
    truncated: found > samples.length,
    samples,
    scanTruncated,
  };
}

// generated_files.record_id is a COMPOSITE key built in another database:
// docxTemplates.js writes `<docType>-<year>-<ref>` for a per-row document and plain
// `<docType>-<year>` for a per-year report. For the per-row shapes the trailing ref
// is a row id in a different database — a collections.id for receipt/certificate/
// samaan, a loan_consents.consent_id for the two consent types. Nothing keeps them
// in step: delete the collection and the PDF index row stays, still unique, now
// pointing at nothing, and the public portal will still offer the file.
const FILE_REF_KINDS = {
  receipt:           { db: 'DB_COLLECTIONS',     table: 'collections',   column: 'id',         numeric: true },
  certificate:       { db: 'DB_COLLECTIONS',     table: 'collections',   column: 'id',         numeric: true },
  samaan:            { db: 'DB_COLLECTIONS',     table: 'collections',   column: 'id',         numeric: true },
  consent_loaner:    { db: 'DB_LOANS_EXPENSES',  table: 'loan_consents', column: 'consent_id', numeric: false },
  consent_guarantor: { db: 'DB_LOANS_EXPENSES',  table: 'loan_consents', column: 'consent_id', numeric: false },
};

// Splits a record_id into the reference it carries, or null when it carries none.
// A per-year report (`report_both-2026`) refers to no row, so it can never be an
// orphan — treating it as one would fill the report with false positives.
export function parseFileRecordId(docType, year, recordId) {
  const id = recordId == null ? '' : recordId.toString();
  const kind = FILE_REF_KINDS[docType];
  if (!kind || !id) return null;
  const base = `${docType}-${parseInt(year, 10)}-`;
  if (!id.startsWith(base)) return null; // per-year report, or a shape we do not model
  const ref = id.slice(base.length);
  if (!ref) return null;
  if (kind.numeric && !/^\d+$/.test(ref)) return null;
  return { ...kind, ref };
}

async function checkGeneratedFileRefs(env) {
  if (!env.DB_FILE_INDEX) return { unavailable: ['DB_FILE_INDEX'] };

  const { results } = await env.DB_FILE_INDEX.prepare(
    `SELECT doc_type, year, record_id
       FROM generated_files
      WHERE record_id IS NOT NULL AND record_id <> ''
      ORDER BY id
      LIMIT ${SCAN_LIMIT + 1}`
  ).all();
  const rows = results || [];
  const scanTruncated = rows.length > SCAN_LIMIT;

  // Group the references by the database+table they point into, so each referent
  // table is queried once rather than once per file.
  const wanted = new Map(); // "db|table|column" -> { spec, refs:Set, rows:[] }
  const unavailable = new Set();
  for (const r of rows.slice(0, SCAN_LIMIT)) {
    const parsed = parseFileRecordId(r.doc_type, r.year, r.record_id);
    if (!parsed) continue;
    if (!env[parsed.db]) { unavailable.add(parsed.db); continue; }
    const key = `${parsed.db}|${parsed.table}|${parsed.column}`;
    if (!wanted.has(key)) wanted.set(key, { spec: parsed, refs: new Set(), rows: [] });
    const g = wanted.get(key);
    g.refs.add(parsed.ref);
    g.rows.push({ ...r, ref: parsed.ref });
  }

  const samples = [];
  let found = 0;
  for (const { spec, refs, rows: refRows } of wanted.values()) {
    const present = await existingValues(env[spec.db], spec.table, spec.column, [...refs]);
    for (const r of refRows) {
      if (present.has(r.ref)) continue;
      found++;
      if (samples.length < SAMPLE_LIMIT) {
        samples.push({
          doc_type: r.doc_type,
          year: r.year,
          record_id: r.record_id,
          missing: `${spec.table}.${spec.column} = ${r.ref}`,
        });
      }
    }
  }

  return {
    found,
    truncated: found > samples.length,
    samples,
    scanTruncated,
    unavailable: unavailable.size ? [...unavailable] : undefined,
  };
}

const CROSS_DB_CHECKS = [
  {
    id: 'orphan_person_ref',
    title: 'Rows naming a member who is not in the members table',
    kind: 'orphan',
    severity: 'error',
    scope: 'cross-database',
    run: checkPersonRefs,
    hint: 'A contribution or loan whose person_id resolves to nobody shows blank on the portal and in every PDF.',
  },
  {
    id: 'orphan_generated_file',
    title: 'Generated documents filed against a row that no longer exists',
    kind: 'orphan',
    severity: 'error',
    scope: 'cross-database',
    run: checkGeneratedFileRefs,
    hint: 'The public portal still offers these files. Clear the index row (clearGeneratedFile) rather than leaving a dead link.',
  },
];

// ---------------------------------------------------------------------------

/** Every check id this module can run, in report order. */
export function checkIds() {
  return [...CHECKS, ...CROSS_DB_CHECKS].map(c => c.id);
}

/**
 * Run the integrity report. READ-ONLY: issues nothing but SELECT.
 *
 * @param opts.only  optional array of check ids to run (an operator narrowing a
 *                   re-run to the one thing they are repairing).
 * @returns {{ generatedAt, ok, summary, checks: [] }}
 *   `ok` is true only when every check RAN and none found anything at
 *   severity 'error'. An unavailable check makes `ok` false — it is not a pass.
 */
export async function runIntegrityReport(env, user, opts = {}) {
  requireSuperadmin(user);

  const all = [...CHECKS, ...CROSS_DB_CHECKS];
  let selected = all;
  if (opts.only != null) {
    const want = new Set((Array.isArray(opts.only) ? opts.only : [opts.only]).map(String));
    const known = new Set(all.map(c => c.id));
    for (const id of want) {
      if (!known.has(id)) throw ValidationError(`Unknown integrity check: ${id}`);
    }
    selected = all.filter(c => want.has(c.id));
  }

  const checks = [];
  for (const c of selected) {
    const base = {
      id: c.id,
      title: c.title,
      kind: c.kind,
      severity: c.severity,
      scope: c.scope || (c.needs || []).join(', '),
      hint: c.hint,
    };
    try {
      let out;
      if (c.run) {
        out = await c.run(env);
      } else {
        const missing = (c.needs || []).filter(b => !env[b]);
        out = missing.length ? { unavailable: missing } : { ...(await runSql(env, c)), sql: squash(c.sql) };
      }
      if (out.unavailable) {
        checks.push({ ...base, status: 'unavailable', reason: `not configured: ${out.unavailable.join(', ')}` });
      } else {
        checks.push({ ...base, status: out.found > 0 ? 'findings' : 'clean', ...out });
      }
    } catch (err) {
      // A check that throws must say so. Swallowing it would report "clean".
      checks.push({ ...base, status: 'error', reason: (err && err.message) || String(err) });
    }
  }

  const findings = checks.filter(c => c.status === 'findings');
  const blocking = findings.filter(c => c.severity === 'error');
  const notRun = checks.filter(c => c.status === 'unavailable' || c.status === 'error');

  return {
    generatedAt: new Date().toISOString(),
    ok: blocking.length === 0 && notRun.length === 0,
    summary: {
      checksRun: checks.length - notRun.length,
      checksNotRun: notRun.length,
      checksWithFindings: findings.length,
      totalFindings: findings.reduce((n, c) => n + (c.found || 0), 0),
      blocking: blocking.map(c => c.id),
      needsReview: findings.filter(c => c.severity === 'review').map(c => c.id),
      notRun: notRun.map(c => c.id),
    },
    checks,
  };
}

async function runSql(env, c) {
  const db = env[c.needs[0]];
  return detect(db, c.sql);
}

// The SQL is echoed back to the operator so they can re-run it by hand for exact
// counts (see the row-cap note in the header). Collapse the indentation first.
function squash(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}
