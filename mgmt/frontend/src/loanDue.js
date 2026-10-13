// Principal + simple interest — the same formula (and rounding) the backend uses in
// loanStatus.js loanTotalDue, so the form shows exactly what the server will accept.
export function loanTotalDue(amount, ratePct, tenureMonths) {
  const p = parseFloat(amount) || 0;
  const r = parseFloat(ratePct) || 0;
  const t = parseFloat(tenureMonths) || 0;
  const interest = Math.round(p * (r / 100) * t * 100) / 100;
  return { principal: p, interest, total: Math.round((p + interest) * 100) / 100 };
}

export const isRepaid = (status) => (status || '').toString().trim().toLowerCase() === 'repaid';

// "2026-10-13" -> "13/10/2026"
export const displayYmd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.split('-').reverse().join('/') : (s || ''));
