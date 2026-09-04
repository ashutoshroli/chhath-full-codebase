// ============ BATCHED LOOKUPS (audit H-11 / M-14) ============
//
// THE PROBLEM these replace:
//
// 1) FULL TABLE SCANS TO FIND ONE ROW. The consent flow alone contained TEN
//    `getSheetDataAsJSON(env, 'USERS')` calls and six `…'LOANS'` calls. Each one
//    reads the WHOLE table into the isolate to build a `userMap` that is then used
//    to look up two or three ids. At 32,000 members that is 32,000 rows read to
//    answer "what is this person's WhatsApp number?".
//
// 2) N+1 LOOPS. getUserProfile ran three sequential `for … await` loops (one query
//    per referenced loan, per loaner's loans, per loaner's name), and
//    getPersonDownloads called isFileGenerated() once per collection row.
//
// WHY THIS IS A CORRECTNESS ISSUE ON THE FREE TIER, NOT JUST A PERFORMANCE ONE:
//   * D1 allows 5,000,000 row reads per DAY across all nine databases. A handful of
//     profile opens or consent submissions could consume a large slice of that.
//   * EVERY D1 query counts as a SUBREQUEST, and the free plan caps a single Worker
//     invocation at 50 (not the 1000 available on paid). A member who has guaranteed
//     ten loans made getUserProfile issue ~35 subrequests, so a slightly busier
//     record would simply start failing.
//
// So these helpers exist to turn "N queries" into "one query with an IN (…) list",
// and "read the whole table" into "read the rows I actually need".
//
// D1 has a practical ceiling on bound parameters per statement, so every IN list is
// chunked. 90 keeps a comfortable margin under the usual 100-parameter limit while
// still collapsing any realistic id set into one or two queries.

import { fromColumnRow } from './tableRegistry.js';

const CHUNK = 90;

function uniqueNonEmpty(ids) {
  const out = new Set();
  for (const id of ids || []) {
    const v = id == null ? '' : id.toString().trim();
    if (v) out.add(v);
  }
  return [...out];
}

function chunks(arr, size = CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Runs `SELECT * FROM <table> WHERE <col> IN (...)` in as few queries as possible
// and returns the rows in the header-keyed shape the rest of the codebase expects
// (so callers keep using u.ID, u.Name, u['Father's Name'], …).
async function rowsByIn(db, table, column, values) {
  const ids = uniqueNonEmpty(values);
  if (!ids.length) return [];
  const out = [];
  for (const group of chunks(ids)) {
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT * FROM ${table} WHERE ${column} IN (${placeholders})`)
      .bind(...group)
      .all();
    for (const r of results || []) out.push(fromColumnRow(table, r));
  }
  return out;
}

/**
 * The USERS rows for the given `USER####` ids, as a map keyed by ID.
 *
 * Drop-in replacement for the pattern repeated ~10 times across loans.js:
 *     const users = await getSheetDataAsJSON(env, 'USERS');
 *     const userMap = {}; users.forEach(u => { userMap[u.ID] = u; });
 * which read every member row to look up two or three of them.
 *
 * A missing id is simply absent from the map — exactly as before, so every existing
 * `userMap[id] || {}` fallback keeps working unchanged.
 */
export async function usersByIdCodes(env, ids) {
  const map = {};
  if (!env || !env.DB_CORE) return map;
  for (const u of await rowsByIn(env.DB_CORE, 'users', 'id_code', ids)) {
    if (u.ID) map[u.ID.toString().trim()] = u;
  }
  return map;
}

/** One USERS row by id, or null. */
export async function userByIdCode(env, id) {
  const map = await usersByIdCodes(env, [id]);
  return map[(id == null ? '' : id.toString().trim())] || null;
}

/**
 * The LOANS row for a loan_id, or null. Replaces
 *     (await getSheetDataAsJSON(env, 'LOANS')).find(l => l['Loan ID'] === loanId)
 * which read every loan ever recorded to find one.
 */
export async function loanByLoanId(env, loanId) {
  if (!env || !env.DB_LOANS_EXPENSES) return null;
  const id = loanId == null ? '' : loanId.toString().trim();
  if (!id) return null;
  const row = await env.DB_LOANS_EXPENSES
    .prepare('SELECT * FROM loans WHERE loan_id = ? LIMIT 1')
    .bind(id).first();
  return row ? fromColumnRow('loans', row) : null;
}

/** LOANS rows for many loan_ids, as a map keyed by Loan ID. */
export async function loansByLoanIds(env, loanIds) {
  const map = {};
  if (!env || !env.DB_LOANS_EXPENSES) return map;
  for (const l of await rowsByIn(env.DB_LOANS_EXPENSES, 'loans', 'loan_id', loanIds)) {
    const key = (l['Loan ID'] || '').toString().trim();
    if (key) map[key] = l;
  }
  return map;
}

/**
 * Every non-replaced consent naming this person, in either role.
 * Indexed by idx_loan_consents_person_id.
 */
export async function consentsForPerson(env, personId) {
  if (!env || !env.DB_LOANS_EXPENSES) return [];
  const id = personId == null ? '' : personId.toString().trim();
  if (!id) return [];
  const { results } = await env.DB_LOANS_EXPENSES.prepare(
    "SELECT * FROM loan_consents WHERE person_id = ? AND status != 'replaced' ORDER BY id ASC"
  ).bind(id).all();
  return results || [];
}

/**
 * Every non-replaced consent belonging to the given loans.
 *
 * Needed because a consent PDF's placeholders include the loan's accepted/pending/
 * declined COUNTS and all three guarantor names — so a loan's full consent set is
 * required, not just the one consent being rendered. Previously obtained by reading
 * the entire loan_consents table.
 */
export async function consentsForLoanIds(env, loanIds) {
  if (!env || !env.DB_LOANS_EXPENSES) return [];
  const ids = uniqueNonEmpty(loanIds);
  if (!ids.length) return [];
  const out = [];
  for (const group of chunks(ids)) {
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await env.DB_LOANS_EXPENSES.prepare(
      `SELECT * FROM loan_consents WHERE loan_id IN (${placeholders}) AND status != 'replaced' ORDER BY id ASC`
    ).bind(...group).all();
    for (const r of results || []) out.push(r);
  }
  return out;
}

/** LOANS rows taken BY a person (loans.name stores the borrower's user id). */
export async function loansByBorrower(env, personId) {
  if (!env || !env.DB_LOANS_EXPENSES) return [];
  const id = personId == null ? '' : personId.toString().trim();
  if (!id) return [];
  const { results } = await env.DB_LOANS_EXPENSES
    .prepare('SELECT * FROM loans WHERE name = ? ORDER BY id ASC')
    .bind(id).all();
  return (results || []).map(r => fromColumnRow('loans', r));
}

/**
 * LOANS rows taken by ANY of the given borrowers, as a flat array.
 *
 * Used by getUserProfile for the legacy guarantor rows that carry no Loan ID and must
 * be matched on Year + Loaner: one query for every referenced loaner instead of one
 * query per loaner.
 */
export async function loansForBorrowers(env, personIds) {
  if (!env || !env.DB_LOANS_EXPENSES) return [];
  return rowsByIn(env.DB_LOANS_EXPENSES, 'loans', 'name', personIds);
}

/**
 * generated_files rows for many record ids, as a map keyed by record_id.
 *
 * Replaces getPersonDownloads' `await isFileGenerated(...)` inside three separate
 * loops — one query per document a member has ever had generated.
 */
export async function generatedFilesByRecordIds(env, recordIds) {
  const map = {};
  if (!env || !env.DB_FILE_INDEX) return map;
  const ids = uniqueNonEmpty(recordIds);
  if (!ids.length) return map;
  for (const group of chunks(ids)) {
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await env.DB_FILE_INDEX.prepare(
      `SELECT doc_type, year, record_id, file_name, public_link
         FROM generated_files WHERE record_id IN (${placeholders})`
    ).bind(...group).all();
    for (const r of results || []) map[r.record_id] = r;
  }
  return map;
}
