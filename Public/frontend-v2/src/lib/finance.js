
export const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

export const parseAmt = (v) =>
  parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;

export const isResellRow = (r) =>
  r && (r['Is Resell'] === true || r['Is Resell'] === 'TRUE' ||
    (typeof r['Is Resell'] === 'string' && r['Is Resell'].trim().toLowerCase() === 'true'));

export function computeBudget(collections, loans, expenses, targetYear) {
  const cols = collections || [];
  const lns = loans || [];
  const exps = expenses || [];
  const isAll = targetYear === 'All';

  const curCol = isAll ? cols : cols.filter((c) => parseInt(c.Year) === targetYear);
  const currentCollection = curCol.reduce((s, c) => s + parseAmt(c.Amount), 0);

  let pastLoanReturned = 0;
  const prevLoans = isAll ? lns : lns.filter((l) => parseInt(l.Year) === (targetYear - 1));
  prevLoans.forEach((l) => {
    const principal = parseAmt(l.Amount);
    const intRatePerMonth = parseAmt(l['Intrest Rate'] || l['Interest Rate']);
    const tenureMonths = parseAmt(l.Tenure);
    const totalInterest = principal * (intRatePerMonth / 100) * tenureMonths;
    pastLoanReturned += principal + totalInterest;
  });

  const totalBudget = currentCollection + pastLoanReturned;

  const curExp = isAll ? exps : exps.filter((e) => parseInt(e.Year) === targetYear);
  const totalExpense = curExp.reduce((s, e) => s + parseAmt(e.Amount), 0);

  const netSurplus = totalBudget - totalExpense;

  return { pastLoanReturned, currentCollection, totalBudget, totalExpense, netSurplus };
}
