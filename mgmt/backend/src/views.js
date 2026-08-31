import { getSheetDataAsJSON, filterByYear } from './crud.js';
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
  const collections = filterByYear(await getSheetDataAsJSON(env, 'COLLECTIONS'), year);
  const expenses = filterByYear(await getSheetDataAsJSON(env, 'EXPENSES'), year);
  const isAll = !year || year === 'All';
  if (isAll) collections.sort((a, b) => parseInt(b.Year) - parseInt(a.Year));

  const totCol = collections.reduce((s, c) => s + parseAmt(c.Amount), 0);
  const totExp = expenses.reduce((s, e) => s + parseAmt(e.Amount), 0);

  const allLoans = await getSheetDataAsJSON(env, 'LOANS');
  const prevLoans = isAll ? allLoans : allLoans.filter(l => parseInt(l.Year) === (parseInt(year) - 1));
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
  const loans = filterByYear(await getSheetDataAsJSON(env, 'LOANS'), year);
  if (!year || year === 'All') loans.sort((a, b) => parseInt(b.Year) - parseInt(a.Year));
  const allGuarantors = await getSheetDataAsJSON(env, 'LOAN GUARANTOR');
  const guarantors = year && year !== 'All' ? allGuarantors.filter(g => parseInt(g.Year) === parseInt(year)) : allGuarantors;
  return { loans, guarantors };
}

export async function getExpensesData(env, year) {
  const expenses = filterByYear(await getSheetDataAsJSON(env, 'EXPENSES'), year);
  if (!year || year === 'All') expenses.sort((a, b) => parseInt(b.Year) - parseInt(a.Year));
  return expenses;
}

export async function getCommitteeData(env, year) {
  const committee = filterByYear(await getSheetDataAsJSON(env, 'COMMITEE MEMBERS'), year);
  if (!year || year === 'All') committee.sort((a, b) => parseInt(b.Year) - parseInt(a.Year));
  return committee;
}

export async function getUserHistory(env, userId) {
  if (!userId) return [];
  const rows = (await getSheetDataAsJSON(env, 'COLLECTIONS')).filter(r => (r.Name || '').toString().trim() === userId.toString().trim());
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
  const rows = (await getSheetDataAsJSON(env, 'COLLECTIONS')).filter(r => parseInt(r.Year) === targetYear);
  const ids = new Set(rows.map(r => (r.Name || '').toString().trim()).filter(Boolean));
  return Array.from(ids);
}

export async function getUserProfile(env, userId) {
  if (!userId) throw new Error('User ID required');
  const id = userId.toString().trim();
  const user = (await getSheetDataAsJSON(env, 'USERS')).find(u => (u.ID || '').toString().trim() === id);
  if (!user) throw new Error('User not found');

  const contributions = (await getSheetDataAsJSON(env, 'COLLECTIONS'))
    .filter(r => (r.Name || '').toString().trim() === id)
    .map(r => ({ Year: parseInt(r.Year), Amount: parseAmt(r.Amount), 'Payment Mode': r['Payment Mode'] || '' }))
    .sort((a, b) => b.Year - a.Year);
  const totalContributed = contributions.reduce((s, c) => s + c.Amount, 0);

  const loansTaken = (await getSheetDataAsJSON(env, 'LOANS'))
    .filter(r => (r.Name || '').toString().trim() === id)
    .map(r => ({
      Year: parseInt(r.Year), Amount: parseAmt(r.Amount),
      'Intrest Rate': r['Intrest Rate'] || r['Interest Rate'] || '',
      Tenure: r.Tenure || '', Status: r.Status || 'Active',
    }))
    .sort((a, b) => b.Year - a.Year);

  const allUsers = await getSheetDataAsJSON(env, 'USERS');
  const nameById = {};
  allUsers.forEach(u => { nameById[u.ID] = u.Name; });
  const allLoans = await getSheetDataAsJSON(env, 'LOANS');

  const guarantorFor = (await getSheetDataAsJSON(env, 'LOAN GUARANTOR'))
    .filter(g => (g.Guarantor || '').toString().trim() === id)
    .map(g => {
      const gLoanId = (g['Loan ID'] || '').toString().trim();
      const loan = gLoanId
        ? allLoans.find(l => (l['Loan ID'] || '').toString().trim() === gLoanId)
        : allLoans.find(l => parseInt(l.Year) === parseInt(g.Year) && (l.Name || '').toString().trim() === (g.Loaner || '').toString().trim());
      return {
        Year: parseInt(g.Year), LoanerId: g.Loaner, LoanerName: nameById[g.Loaner] || g.Loaner,
        Amount: loan ? parseAmt(loan.Amount) : null, Status: loan ? (loan.Status || 'Active') : null,
      };
    })
    .sort((a, b) => b.Year - a.Year);

  const committeeYears = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS'))
    .filter(r => (r.Name || '').toString().trim() === id)
    .map(r => ({ Year: parseInt(r.Year), 'View Role': r['View Role'] || '' }))
    .sort((a, b) => b.Year - a.Year);

  return { user, contributions, totalContributed, loansTaken, guarantorFor, committeeYears };
}
