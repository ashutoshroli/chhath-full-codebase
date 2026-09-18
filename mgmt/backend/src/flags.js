// ============ SHARED FLAG PARSING ============
//
// Audit 6.1: `isTruthyFlag` was reimplemented in ~6 files (crud.js, whatsapp.js,
// popups.js, docxTemplates.js, errorLog.js, announcements.js) with subtly
// DIFFERENT logic — announcements.js's copy didn't trim or accept 'yes', which is
// exactly the class of divergence that previously caused real "Active but never
// shown" popup bugs. This is now the single source of truth for the mgmt Worker.
//
// D1 flag columns have TEXT affinity, so a bound 1 comes back as the STRING '1',
// and the original sheet migration wrote 'True'/'False'. Accept every form.
//
// Live-data addendum: the dropdown_lists id rebuild stored a bound 1 as the
// DECIMAL-formatted string '1.0' (D1 TEXT affinity re-serialized the number), which the
// old set-based check dropped — so the List Management Village tab rendered "No values
// found." for rows that were correctly in D1. We therefore also accept the decimal
// spelling of ON: a numeric string that equals 1 ('1.0' -> true). Everything that was
// already OFF stays OFF — '0.0' parses to 0, and non-1 numbers like '2' / '-1' / '1.5'
// are still rejected exactly as before (see the M-31 table in frontend-medium-batch).
//
// (The Public Worker is a SEPARATE deployment with no shared source tree, so it
// keeps its own identical copy on purpose — see Public/backend/src/index.js.)
export function isTruthyFlag(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  const s = v.toString().trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  return Number(s) === 1;
}
