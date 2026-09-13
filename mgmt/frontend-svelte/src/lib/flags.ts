// Ported verbatim from mgmt/frontend/src/flags.js. MUST stay behaviourally
// identical to mgmt/backend/src/flags.js (audit M-31): trims whitespace and
// accepts true/1/'1'/'true'/'yes'. Source of truth for "is this flag on?".
export function isTruthyFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  const s = v.toString().trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
