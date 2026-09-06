import { getSheetDataAsJSON, getSheetDataByYear, getSheetDataByColumn, filterByYear } from './crud.js';
import { fromColumnRow } from './tableRegistry.js';
import { requireSuperadmin, ValidationError } from './auth.js';
import { usersByIdCodes, loansByLoanIds, loansForBorrowers } from './lookups.js';
import { parseAmt } from './money.js'; // audit L-13: shared, was duplicated here

// audit M-19 — this used to do FIVE full table scans, shipping every row of
// COLLECTIONS, LOANS, COMMITEE MEMBERS, EXPENSES and MANUAL YEARS into the isolate
// only to read one column off each and throw the rest away. On the year the
// committee actually uses this is tens of thousands of rows read to produce a list
// of about six integers, and it runs on every cache miss and after every write
// (each one bumps the data version and invalidates the cached copy).
//
// `SELECT DISTINCT year` is answered from the year index added in migration
// 2026-09-05/01..02 without touching the rows at all, and the five run
// concurrently instead of in series.
//
// Kept as five statements rather than one UNION because the tables live in three
// different D1 databases, which cannot be joined.
const YEAR_SOURCES = [
  ['DB_COLLECTIONS', 'collections'],
  ['DB_LOANS_EXPENSES', 'loans'],
  ['DB_CORE', 'committee_members'],
  ['DB_LOANS_EXPENSES', 'expenses'],
  ['DB_CORE', 'manual_years'],
];

export async function getYears(env) {
  const results = await Promise.all(YEAR_SOURCES.map(async ([binding, table]) => {
    const db = env[binding];
    if (!db) return [];
    try {
      const { results: rows } = await db
        .prepare(`SELECT DISTINCT year FROM ${table} WHERE year IS NOT NULL`).all();
      return rows || [];
    } catch (e) {
      // A table missing on this deployment must not blank the whole year picker —
      // which is the navigation for the entire portal.
      return [];
    }
  }));

  const years = new Set();
  for (const rows of results) {
    for (const r of rows) {
      const y = parseInt(r.year);
      if (y) years.add(y);
    }
  }
  return Array.from(years).sort((a, b) => b - a);
}

export async function addYear(env, year, user) {
  requireSuperadmin(user);
  const y = parseInt(year);
  if (!y) throw ValidationError('Valid year required');
  const manualYears = await getSheetDataAsJSON(env, 'MANUAL YEARS');
  const already = manualYears.some(r => parseInt(r.Year) === y) || (await getYears(env)).includes(y);
  if (!already) {
    await env.DB_CORE.prepare('INSERT INTO manual_years (year, addedby, addedat) VALUES (?, ?, ?)')
      .bind(y, user.name, new Date().toISOString()).run();
  }
  return { success: true };
}

// audit P-2: the Home screen's budget figures were computed by shipping EVERY
// collection row and EVERY expense row into the isolate and summing them in JS. With
// year = 'All' that is the entire financial history of the committee, on the very
// first screen every user sees after login — a large D1 read, a large JSON payload
// over a village mobile connection, and then a large render (see the row cap in
// Home.jsx).
//
// The totals are now computed by D1 with SUM(), which is what a database is for:
//   * exact — no rounding difference, since these are the same REAL values;
//   * O(1) payload — the numbers no longer depend on how many rows exist;
//   * index-friendly — for a specific year it is a covered range scan.
//
// The ROW LIST is treated differently by scope, deliberately:
//   * a SPECIFIC year returns every row, unchanged. That is where data entry and
//     lookup actually happen, a single year's rows are naturally bounded, and the
//     existing client-side search must keep working over the complete set.
//   * 'All' (the lifetime overview) returns only the most recent
//     ALL_YEARS_ROW_LIMIT rows plus `hasMore` + `totalRows`, so the UI can say so
//     plainly. The TOTALS stay exact regardless, because they come from SUM().
// This keeps every per-year workflow byte-identical while removing the unbounded
// case, which is the one that actually threatens the free tier.
const ALL_YEARS_ROW_LIMIT = 1000;

export async function getHomeData(env, year) {
  const isAll = !year || year === 'All';
  const y = isAll ? null : parseInt(year);

  // --- Totals, computed in SQL ---
  // COALESCE so an empty year yields 0 rather than NULL. The loan formula is the
  // same one the old JS loop used: principal + principal * (rate/100) * tenure,
  // summed over the PREVIOUS year's loans (whose repayment lands in this year).
  const [colAgg, expAgg, loanAgg] = await Promise.all([
    env.DB_COLLECTIONS.prepare(
      isAll
        ? 'SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM collections'
        : 'SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM collections WHERE year = ?'
    ).bind(...(isAll ? [] : [y])).first(),
    env.DB_LOANS_EXPENSES.prepare(
      isAll
        ? 'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses'
        : 'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE year = ?'
    ).bind(...(isAll ? [] : [y])).first(),
    env.DB_LOANS_EXPENSES.prepare(
      isAll
        ? `SELECT COALESCE(SUM(COALESCE(amount,0) + COALESCE(amount,0) * (COALESCE(intrest_rate,0) / 100.0) * COALESCE(tenure,0)), 0) AS total FROM loans`
        : `SELECT COALESCE(SUM(COALESCE(amount,0) + COALESCE(amount,0) * (COALESCE(intrest_rate,0) / 100.0) * COALESCE(tenure,0)), 0) AS total FROM loans WHERE year = ?`
    ).bind(...(isAll ? [] : [y - 1])).first(),
  ]);

  const totCol = Number(colAgg && colAgg.total) || 0;
  const totExp = Number(expAgg && expAgg.total) || 0;
  const pastRet = Number(loanAgg && loanAgg.total) || 0;
  const totalRows = Number(colAgg && colAgg.n) || 0;

  // --- The row list ---
  let collections;
  let hasMore = false;
  if (isAll) {
    const { results } = await env.DB_COLLECTIONS.prepare(
      'SELECT * FROM collections ORDER BY year DESC, id DESC LIMIT ?'
    ).bind(ALL_YEARS_ROW_LIMIT + 1).all();
    const rows = results || [];
    hasMore = rows.length > ALL_YEARS_ROW_LIMIT;
    collections = rows.slice(0, ALL_YEARS_ROW_LIMIT).map(r => fromColumnRow('collections', r));
  } else {
    // Unchanged for a specific year: every row, same shape, same order as before.
    collections = await getSheetDataByYear(env, 'COLLECTIONS', year);
  }

  return {
    collections,
    totCol, totExp, pastRet,
    totBudget: totCol + pastRet,
    surplus: (totCol + pastRet) - totExp,
    // New, additive fields — an older cached frontend simply ignores them.
    totalRows,
    shownRows: collections.length,
    hasMore,
    rowLimit: isAll ? ALL_YEARS_ROW_LIMIT : null,
  };
}

export async function getLoansData(env, year) {
  // Phase 1: WHERE year=? (indexed) for a specific year; full read for 'All'.
  const loans = await getSheetDataByYear(env, 'LOANS', year);
  if (!year || year === 'All') loans.sort((a, b) => parseInt(b.Year) - parseInt(a.Year));
  const guarantors = await getSheetDataByYear(env, 'LOAN GUARANTOR', year);
  return { loans, guarantors };
}

export async function getExpensesData(env, year) {
  const expenses = await getSheetDataByYear(env, 'EXPENSES', year); // Phase 1: indexed WHERE year=?
  if (!year || year === 'All') expenses.sort((a, b) => parseInt(b.Year) - parseInt(a.Year));
  return expenses;
}

export async function getCommitteeData(env, year) {
  const committee = await getSheetDataByYear(env, 'COMMITEE MEMBERS', year); // Phase 1: indexed WHERE year=?
  if (!year || year === 'All') committee.sort((a, b) => parseInt(b.Year) - parseInt(a.Year));
  return committee;
}

export async function getUserHistory(env, userId) {
  if (!userId) return [];
  // Phase 1: fetch this contributor's collection rows via WHERE name=? (indexed by
  // idx_collections_name) instead of scanning the whole collections table and
  // filtering in JS. The `name` column stores the contributor's user id (same value
  // the old .filter compared against r.Name), so the row set is identical.
  const rows = await getSheetDataByColumn(env, 'COLLECTIONS', 'name', userId.toString().trim());
  const byYear = {};
  rows.forEach(r => {
    const y = parseInt(r.Year);
    if (!y) return;
    if (!byYear[y]) byYear[y] = { Amount: 0, HasSamaan: false, HasKaam: false };
    const type = (r['Contribution Type'] || '1').toString();
    if (type === '1') byYear[y].Amount += parseAmt(r.Amount);
    else if (type === '2') byYear[y].HasSamaan = true;
    else if (type === '3') byYear[y].HasKaam = true;
  });
  return Object.keys(byYear)
    .map(y => ({ Year: parseInt(y), Amount: byYear[y].Amount, HasSamaan: byYear[y].HasSamaan, HasKaam: byYear[y].HasKaam }))
    .sort((a, b) => b.Year - a.Year)
    .slice(0, 5);
}

export async function getYearContributors(env, year) {
  const targetYear = (!year || year === 'All') ? new Date().getFullYear() : parseInt(year);
  // Phase 1: WHERE year=? (indexed). targetYear is always a concrete year here
  // (never 'All'), so this is a scoped read.
  const rows = await getSheetDataByYear(env, 'COLLECTIONS', targetYear);
  const ids = new Set(rows.map(r => (r.Name || '').toString().trim()).filter(Boolean));
  return Array.from(ids);
}

export async function getUserProfile(env, userId) {
  if (!userId) throw ValidationError('User ID required');
  const id = userId.toString().trim();

  // Phase 1: this used to do SEVEN full-table scans (USERS×2, COLLECTIONS, LOANS×2,
  // LOAN GUARANTOR, COMMITEE MEMBERS) and join everything in JS. Now every
  // person-scoped read uses an INDEXED lookup, and the only broad data still needed
  // — the loaner NAMES + loan details referenced by THIS person's guarantor rows —
  // is fetched for just those specific loans/loaners, not the whole tables. Output
  // is identical to before (same fields, same filters, same sort order).

  // These four reads are independent of one another, so they run CONCURRENTLY rather
  // than as four sequential awaits. Same queries, same results — a quarter of the
  // wall-clock, which matters against the Worker's CPU/duration budget.
  // (users.id_code is now genuinely indexed — see migration 2026-09-05/01.)
  const [ownRows, collectionRows, loanRows, guarantorRows] = await Promise.all([
    getSheetDataByColumn(env, 'USERS', 'id_code', id),
    getSheetDataByColumn(env, 'COLLECTIONS', 'name', id),
    getSheetDataByColumn(env, 'LOANS', 'name', id),
    getSheetDataByColumn(env, 'LOAN GUARANTOR', 'guarantor', id),
  ]);

  const user = ownRows[0];
  if (!user) throw ValidationError('User not found');

  const contributions = collectionRows
    .map(r => ({ Year: parseInt(r.Year), Amount: parseAmt(r.Amount), 'Payment Mode': r['Payment Mode'] || '' }))
    .sort((a, b) => b.Year - a.Year);
  const totalContributed = contributions.reduce((s, c) => s + c.Amount, 0);

  const loansTaken = loanRows
    .map(r => ({
      Year: parseInt(r.Year), Amount: parseAmt(r.Amount),
      'Intrest Rate': r['Intrest Rate'] || r['Interest Rate'] || '',
      Tenure: r.Tenure || '', Status: r.Status || 'Active',
    }))
    .sort((a, b) => b.Year - a.Year);

  // For each guarantor row we need the referenced loan (by Loan ID, or legacy
  // Year+Loaner) and the loaner's display name. Resolve ONLY the loans/loaners
  // actually referenced — usually a handful — instead of loading every loan+user.
  const neededLoanIds = new Set();
  const neededLoanerIds = new Set();
  guarantorRows.forEach(g => {
    const gLoanId = (g['Loan ID'] || '').toString().trim();
    if (gLoanId) neededLoanIds.add(gLoanId);
    if (g.Loaner) neededLoanerIds.add((g.Loaner || '').toString().trim());
  });

  // audit H-11: these were THREE sequential `for … await` loops — one D1 query per
  // referenced loan, one per referenced loaner's loans, and one per loaner's display
  // name. A member who has guaranteed ten loans therefore issued ~30 queries here,
  // and on the FREE plan every D1 query is a subrequest against a hard cap of 50 per
  // invocation — so a slightly busier record did not just get slow, it started
  // failing outright. All three are now single batched IN (...) reads that run
  // concurrently.
  const loanIds = [...neededLoanIds];
  const loanerIds = [...neededLoanerIds].filter(Boolean);

  const [loansById, loanerLoanRows, loanerUserMap] = await Promise.all([
    loansByLoanIds(env, loanIds),
    // Legacy guarantor rows carry no Loan ID and are matched on Year + Loaner, so we
    // still need those loaners' loans — but as ONE query, not one per loaner.
    loansForBorrowers(env, loanerIds),
    usersByIdCodes(env, loanerIds),
  ]);

  const loansByLoanId = loansById;
  const loansByLoanerName = {};
  for (const l of loanerLoanRows) {
    const key = (l.Name || '').toString().trim();
    if (key) (loansByLoanerName[key] = loansByLoanerName[key] || []).push(l);
  }
  const nameById = {};
  for (const id of loanerIds) nameById[id] = loanerUserMap[id] ? loanerUserMap[id].Name : undefined;

  const guarantorFor = guarantorRows
    .map(g => {
      const gLoanId = (g['Loan ID'] || '').toString().trim();
      const loanerId = (g.Loaner || '').toString().trim();
      const loan = gLoanId
        ? loansByLoanId[gLoanId]
        : (loansByLoanerName[loanerId] || []).find(l => parseInt(l.Year) === parseInt(g.Year) && (l.Name || '').toString().trim() === loanerId);
      return {
        Year: parseInt(g.Year), LoanerId: g.Loaner, LoanerName: nameById[loanerId] || g.Loaner,
        Amount: loan ? parseAmt(loan.Amount) : null, Status: loan ? (loan.Status || 'Active') : null,
      };
    })
    .sort((a, b) => b.Year - a.Year);

  const committeeYears = (await getSheetDataByColumn(env, 'COMMITEE MEMBERS', 'name', id))
    .map(r => ({ Year: parseInt(r.Year), 'View Role': r['View Role'] || '' }))
    .sort((a, b) => b.Year - a.Year);

  return { user, contributions, totalContributed, loansTaken, guarantorFor, committeeYears };
}
