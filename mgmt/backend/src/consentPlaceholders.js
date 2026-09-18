// ============ SHARED CONSENT PLACEHOLDER BUILDER ============
//
// There used to be TWO independent consent placeholder maps that silently
// disagreed, which meant the SAME .docx template produced two different PDFs:
//
//   loans.js  getConsentByToken()      -> full set (24+ keys)  [Consent page]
//   docxTemplates.js base/buildBase()  -> 6 keys only          [Bulk Generate,
//                                                               Download Center]
//
// Because docxFill.js uses `nullGetter: () => ''`, the 11 festival/count
// placeholders that ARE documented in both DocxTemplates.jsx and
// ConsentTemplates.jsx rendered as BLANK in bulk-generated PDFs with no error
// and no log entry. `LOAN_CONSENT_ID` was missing for guarantor docs the same
// way, and statusLabel() existed as two copies — one with verification/decline
// remarks and one without — so {GUARANTOR_1_STATUS} showed remarks on the
// consent page and dropped them in bulk.
//
// This module is now the single source of truth for both.

import { getFestivalDates, dayNamesOf } from './settings.js';

// The FULL version (with verification + decline remarks). docxTemplates.js had a
// trimmed copy that silently dropped the remarks.
export function statusLabel(s, c) {
  if (s === 'accepted') {
    const v = c && c.verification_status;
    const suffix = v === 'verified'
      ? ' — Verified / सत्यापित'
      : v === 'rejected'
        ? ` — Rejected / अस्वीकृत${c && c.verification_remarks ? ` (Remarks: ${c.verification_remarks})` : ''}`
        : ' — Pending Verification / सत्यापन लंबित';
    return 'Accepted / स्वीकृत' + suffix;
  }
  if (s === 'declined') {
    return 'Declined / अस्वीकृत' + (c && c.decline_remarks ? ` (Remarks: ${c.decline_remarks})` : '');
  }
  return 'Pending / लंबित';
}

// Documented in the UI as GUARANTOR_1..3. We always emit at least these three
// (blank when there are fewer guarantors) so a template never shows a stale row,
// and we also emit any extras that genuinely exist so a 4th/5th guarantor is not
// silently un-renderable.
// audit L-8: un-exported — used only inside this module.
const DOCUMENTED_GUARANTOR_SLOTS = 3;

// The datetime a consent decision carries. responded_at is '' until a decision
// is recorded, so fall back to created_at. Module-scoped so both
// buildConsentPlaceholders and consentPlaceholderFactory agree on the value.
function datetimeOf(c) {
  return (c && (c.responded_at || c.created_at)) || '';
}

/**
 * Builds the complete consent placeholder map.
 *
 * @param env            Worker env (needs DB_CORE for festival dates)
 * @param loan           the LOANS row (header-keyed, e.g. loan['Loan ID'])
 * @param allConsents    every non-'replaced' loan_consents row for this loan
 * @param targetConsent  the consent this document is FOR (loaner or guarantor)
 * @param nameOf         (personId) => display name
 */
export async function buildConsentPlaceholders(env, loan, allConsents, targetConsent, nameOf) {
  const consents = allConsents || [];
  const guarantorConsents = consents.filter(c => c.role === 'guarantor');
  const loanerConsent = consents.find(c => c.role === 'loaner');

  const acceptedCount = guarantorConsents.filter(c => c.status === 'accepted').length;
  const pendingCount = guarantorConsents.filter(c => c.status === 'pending').length;
  const declinedCount = guarantorConsents.filter(c => c.status === 'declined').length;

  // Festival dates live in DB_CORE and were only ever read on the consent page —
  // this is what made DIWALI_*/NAHAY_KHAY_*/CHHATH_* blank everywhere else.
  const festival = await getFestivalDates(env, loan.Year);
  const diwali = dayNamesOf(festival['Diwali Next Day Date']);
  const nahayKhay = dayNamesOf(festival['Nahay-Khay Date']);
  const chhathArghya = dayNamesOf(festival['Chhath Morning Arghya Date']);
  const finalRepay = dayNamesOf(loan['Final Repayment Date']);

  const bilingual = (d) => (d.en ? `${d.en} / ${d.hi}` : '');

  const placeholders = {
    LOANER_NAME: nameOf(loan.Name),
    // Kept as "the person this document is for" to match the existing consent
    // page behaviour exactly (for a loaner doc that is the loaner's own name).
    GUARANTOR_NAME: targetConsent ? nameOf(targetConsent.person_id) : '',

    LOAN_AMOUNT: loan.Amount,
    MONTHLY_INTEREST_RATE: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
    MINIMUM_TENURE_MONTHS: loan.Tenure || '',
    FINAL_REPAYMENT_DATE: loan['Final Repayment Date'] || '',
    FINAL_REPAYMENT_DAY_NAME: bilingual(finalRepay),
    FUND_YEAR: loan.Year,

    // Both IDs are ALWAYS present now. Previously the bulk path emitted
    // LOAN_CONSENT_ID only for loaner docs and CONSENT_ID only for guarantor
    // docs, even though the UI documents both for both.
    LOAN_CONSENT_ID: loanerConsent ? loanerConsent.consent_id : '',
    CONSENT_ID: targetConsent ? targetConsent.consent_id : '',

    // Loan-level (loaner) consent date/time + status. Safe in the factory base.
    LOAN_CONSENT_DATETIME: datetimeOf(loanerConsent),
    LOAN_STATUS: loanerConsent ? statusLabel(loanerConsent.status, loanerConsent) : '',

    // Per-target consent date/time + status (loaner OR guarantor doc). The
    // factory overrides these per consent so a whole-loan iteration is correct.
    CONSENT_DATETIME: targetConsent ? datetimeOf(targetConsent) : '',
    CONSENT_STATUS: targetConsent ? statusLabel(targetConsent.status, targetConsent) : '',

    DIWALI_NEXT_DAY_DATE: festival['Diwali Next Day Date'] || '',
    DIWALI_NEXT_DAY_DAY_NAME: bilingual(diwali),
    NAHAY_KHAY_DATE: festival['Nahay-Khay Date'] || '',
    NAHAY_KHAY_DAY_NAME: bilingual(nahayKhay),
    CHHATH_MORNING_ARGHYA_DATE: festival['Chhath Morning Arghya Date'] || '',
    CHHATH_MORNING_ARGHYA_DAY_NAME: bilingual(chhathArghya),

    ACCEPTED_COUNT: acceptedCount,
    PENDING_COUNT: pendingCount,
    DECLINED_COUNT: declinedCount,
  };

  const slots = Math.max(DOCUMENTED_GUARANTOR_SLOTS, guarantorConsents.length);
  for (let i = 0; i < slots; i++) {
    const c = guarantorConsents[i];
    placeholders[`GUARANTOR_${i + 1}_NAME`] = c ? nameOf(c.person_id) : '';
    placeholders[`GUARANTOR_${i + 1}_STATUS`] = c ? statusLabel(c.status, c) : '';
  }

  return placeholders;
}

/**
 * Same map, but for a whole loan at once (used by Bulk Generate / Download
 * Center, which iterate many consents per loan and would otherwise re-read the
 * festival dates for every single record).
 *
 * @returns (targetConsent) => placeholders
 */
export async function consentPlaceholderFactory(env, loan, allConsents, nameOf) {
  // Resolve the loan-level parts exactly once...
  const base = await buildConsentPlaceholders(env, loan, allConsents, null, nameOf);
  // ...then vary only the two per-consent fields.
  return (targetConsent) => Object.assign({}, base, {
    CONSENT_ID: targetConsent ? targetConsent.consent_id : '',
    GUARANTOR_NAME: targetConsent ? nameOf(targetConsent.person_id) : '',
    // Per-consent date/time + status. LOAN_CONSENT_DATETIME/LOAN_STATUS are
    // loan-level and stay as computed in the base.
    CONSENT_DATETIME: targetConsent ? datetimeOf(targetConsent) : '',
    CONSENT_STATUS: targetConsent ? statusLabel(targetConsent.status, targetConsent) : '',
  });
}
