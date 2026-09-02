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
// (The Public Worker is a SEPARATE deployment with no shared source tree, so it
// keeps its own identical copy on purpose — see Public/backend/src/index.js.)
export function isTruthyFlag(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  const s = v.toString().trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
