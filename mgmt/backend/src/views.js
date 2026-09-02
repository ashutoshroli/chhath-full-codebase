import { getSheetDataAsJSON, getSheetDataByYear, getSheetDataByColumn, filterByYear } from './crud.js';
import { requireSuperadmin } from './auth.js';

const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;

export async function getYears(env) {
  let years = new Set();
  for (const sheetName of ['COLLECTIONS', 'LOANS', 'COMMITEE MEMBERS', 'EXPENSES', 'MANUAL YEARS']) {
    (await getSheetDataAsJSON(env, sheetName)).forEach(r => { if (r.Year) years.add(parseInt(r.Year)); });
  }
  return Array.from(years).sort((a, b) => b - a);
}

export async function addYear(env, year, user) {
  requireSuperadmin(user);
  const y = parseInt(year);
  if (!y) throw new Error('Valid year required');
  const manualYears = await getSheetDataAsJSON(env, 'MANUAL YEARS');
  const already = manualYears.some(r => parseInt(r.Year) === y) || (await getYears(env)).includes(y);
  if (!already) {
    await env.DB_CORE.prepare('INSERT INTO manual_years (year, addedby, addedat) VALUES (?, ?, ?)')
      .bind(y, user.name, new Date().toISOString()).run();
  }
  return { success: true };
}

export async function getHomeData(env, year) {
  const isAll = !year || year === 'All';
  // Phase 1: when a specific year is requested, scope the reads with WHERE year=?
  // (indexed) instead of scanning the whole table and filtering in JS. For 'All'
  // we still read everything (that view genuinely needs every row). Output is
  // identical either way — getSheetDataByYear returns the same shape as
  // filterByYear(getSheetDataAsJSON(...)).
  const collections = await getSheetDataByYear(env, 'COLLECTIONS', year);
  const expenses = await getSheetDataByYear(env, 'EXPENSES', year);
  if (isAll) collections.sort((a, b) => parseInt(b.Year) - parseInt(a.Year));

  const totCol = collections.reduce((s, c) => s + parseAmt(c.Amount), 0);
  const totExp = expenses.reduce((s, e) => s + parseAmt(e.Amount), 0);

  // prevLoans = loans of the PREVIOUS year (year-1) whose repayment lands this
  // year. Scope directly to year-1 (indexed) instead of loading all loans; for
  // 'All' we still need every loan.
  const prevLoans = isAll
    ? await getSheetDataAsJSON(env, 'LOANS')
    : await getSheetDataByYear(env, 'LOANS', parseInt(year) - 1);
  let pastRet = 0;
  prevLoans.forEach(l => {
    const principal = parseAmt(l.Amount);
    const rate = parseAmt(l['Intrest Rate'] || l['Interest Rate']);
    const tenure = parseAmt(l.Tenure);
    pastRet += principal + (principal * (rate / 100) * tenure);
  });

  return { collections, totCol, totExp, pastRet, totBudget: totCol + pastRet, surplus: (totCol + pastRet) - totExp };
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
  if (!userId) throw new Error('User ID required');
  const id = userId.toString().trim();

  // Phase 1: this used to do SEVEN full-table scans (USERS×2, COLLECTIONS, LOANS×2,
  // LOAN GUARANTOR, COMMITEE MEMBERS) and join everything in JS. Now every
  // person-scoped read uses an INDEXED lookup, and the only broad data still needed
  // — the loaner NAMES + loan details referenced by THIS person's guarantor rows —
  // is fetched for just those specific loans/loaners, not the whole tables. Output
  // is identical to before (same fields, same filters, same sort order).

  // The user's own row (indexed: idx_users... on id_code). USERS keeps the header
  // shape where the id lives under `ID`.
  const user = (await getSheetDataByColumn(env, 'USERS', 'id_code', id))[0];
  if (!user) throw new Error('User not found');

  const contributions = (await getSheetDataByColumn(env, 'COLLECTIONS', 'name', id))
    .map(r => ({ Year: parseInt(r.Year), Amount: parseAmt(r.Amount), 'Payment Mode': r['Payment Mode'] || '' }))
    .sort((a, b) => b.Year - a.Year);
  const totalContributed = contributions.reduce((s, c) => s + c.Amount, 0);

  const loansTaken = (await getSheetDataByColumn(env, 'LOANS', 'name', id))
    .map(r => ({
      Year: parseInt(r.Year), Amount: parseAmt(r.Amount),
      'Intrest Rate': r['Intrest Rate'] || r['Interest Rate'] || '',
      Tenure: r.Tenure || '', Status: r.Status || 'Active',
    }))
    .sort((a, b) => b.Year - a.Year);

  // This person's guarantor rows (indexed: idx_loan_guarantors_guarantor).
  const guarantorRows = await getSheetDataByColumn(env, 'LOAN GUARANTOR', 'guarantor', id);

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

  // Fetch referenced loans by loan_id (indexed: idx_loans_loan_id). Legacy rows
  // with no Loan ID fall back to a Year+Loaner match, so for those we also pull the
  // loaner's loans by name (indexed: idx_loans_name).
  const loansByLoanId = {};
  const loansByLoanerName = {};
  for (const lid of neededLoanIds) {
    const rows = await getSheetDataByColumn(env, 'LOANS', 'loan_id', lid);
    if (rows[0]) loansByLoanId[lid] = rows[0];
  }
  for (const lname of neededLoanerIds) {
    if (!lname) continue;
    loansByLoanerName[lname] = await getSheetDataByColumn(env, 'LOANS', 'name', lname);
  }
  // Loaner display names (indexed lookup per referenced loaner).
  const nameById = {};
  for (const lid of neededLoanerIds) {
    if (!lid || nameById[lid] !== undefined) continue;
    const u = (await getSheetDataByColumn(env, 'USERS', 'id_code', lid))[0];
    nameById[lid] = u ? u.Name : undefined;
  }

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
