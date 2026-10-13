import { ValidationError } from './auth.js';

// Shared by loans.js (the repayment workflow) and crud.js (the generic edit/delete
// path), which cannot import each other.
//
// 'Repaid' is a STATE the repayment workflow owns: markLoanRepaid sets it together
// with the Cash/Online split, undoLoanRepaid clears it. Nothing else may write it,
// otherwise a loan could be "repaid" with no record of the money — and the budget
// (which now counts only repaid loans) would count money that never came back.

export const REPAID = 'Repaid';

export const isRepaidStatus = (v) =>
  (v === null || v === undefined ? '' : v.toString()).trim().toLowerCase() === 'repaid';

// The status value a client payload is trying to write, whichever key it used.
function payloadStatus(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  for (const [k, v] of Object.entries(payload)) {
    if (k.toString().trim().toLowerCase() === 'status') return v;
  }
  return undefined;
}

/** Throws unless the payload leaves `status` alone or sets it to something other than Repaid. */
export function assertNotRepaidStatus(payload) {
  if (isRepaidStatus(payloadStatus(payload))) {
    throw ValidationError(
      'A loan can only be marked Repaid from its ⋮ menu → "Mark as Repaid", which records the Cash / Online amounts.'
    );
  }
}

/** Principal + simple interest, the same formula the Home screen and the budget use. Rounded to paise. */
export function loanTotalDue(amount, ratePct, tenureMonths) {
  const p = parseFloat(amount) || 0;
  const r = parseFloat(ratePct) || 0;
  const t = parseFloat(tenureMonths) || 0;
  const interest = Math.round(p * (r / 100) * t * 100) / 100;
  return { principal: p, interest, total: Math.round((p + interest) * 100) / 100 };
}
