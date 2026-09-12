// Money formatting + budget math for the v2 public portal.
//
// WHY THIS EXISTS
// The budget hero on the Home page reproduces the exact figures the old site
// computed in refreshData(). That math is subtle (a year's budget is boosted by
// the PREVIOUS year's loans being returned WITH interest), so it lives here as a
// framework-free, unit-tested module rather than being retyped inside an Astro
// island. Ported verbatim from Public/frontend/script.js.

// Indian-rupee currency formatting, no paise. `n||0` guards null/undefined/NaN.
export const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

// Parse a possibly-formatted amount ('₹1,200', '1,200.50') into a Number,
// stripping every character that is not a digit, dot or minus. Falsy/garbage -> 0.
export const parseAmt = (v) =>
  parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;

// A collection row is a "Resell" (committee resold a donated item) when Is Resell
// is truthy. Such a row has NO contributor person — its Name field does not point
// at a USER — so the caller must show the resold item (Detail), NOT run it through
// the user lookup (which would render "Unknown User"). Mirrors mgmt Home.jsx.
export const isResellRow = (r) =>
  r && (r['Is Resell'] === true || r['Is Resell'] === 'TRUE' ||
    (typeof r['Is Resell'] === 'string' && r['Is Resell'].trim().toLowerCase() === 'true'));

// Reproduce refreshData()'s budget math EXACTLY.
//
// `targetYear` is either a year Number or the string 'All' (lifetime view).
//
//   currentCollection = sum of every collection Amount for the target year
//   pastLoanReturned  = for each PRIOR-year loan (year === targetYear - 1),
//                       principal + principal*(intRatePerMonth/100)*tenureMonths.
//     WHY previous-year loans: the committee lends its surplus out and the money
//     comes back the FOLLOWING year with interest, so THIS year's budget is
//     boosted by LAST year's loans being returned. The interest rate column is
//     misspelled 'Intrest Rate' in the schema; we check that FIRST, then the
//     correctly-spelled 'Interest Rate', so both payload shapes work.
//   totalBudget  = currentCollection + pastLoanReturned
//   totalExpense = sum of every expense Amount for the target year
//   netSurplus   = totalBudget - totalExpense
//
// Every array is coalesced to [] so a partial/older snapshot never throws.
export function computeBudget(collections, loans, expenses, targetYear) {
  const cols = collections || [];
  const lns = loans || [];
  const exps = expenses || [];
  const isAll = targetYear === 'All';

  const curCol = isAll ? cols : cols.filter((c) => parseInt(c.Year) === targetYear);
  const currentCollection = curCol.reduce((s, c) => s + parseAmt(c.Amount), 0);

  let pastLoanReturned = 0;
  // NOTE: targetYear MINUS 1 — a year is credited with the PREVIOUS year's
  // returned loans (see WHY above). In the lifetime ('All') view, every loan
  // counts since its return has (conceptually) already happened.
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
