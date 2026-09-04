-- ============================================================================
-- Missing indexes — 2026-09-05  ·  DB: chhath-loans-expenses     (audit H-10)
--
--   wrangler d1 execute chhath-loans-expenses --remote --file=./migration/2026-09-05/02-loans-expenses-indexes.sql
--
-- Idempotent (CREATE INDEX IF NOT EXISTS only). Nothing dropped, no row modified.
-- ============================================================================


-- loan_consents.consent_id — the business key of the whole consent flow, and it
-- had no index. Every one of these is `WHERE consent_id = ?`:
--     setConsentVerification()   the Admin verify/reject action
--     resendConsent()            resend an invitation
--     replaceGuarantor()         swap a guarantor
--     notifyConsentVerified()    the post-verification WhatsApp
-- so each was a full scan of loan_consents.
CREATE INDEX IF NOT EXISTS idx_loan_consents_consent_id ON loan_consents (consent_id);

-- loan_consents.role / .verification_status — the consent list and the review queue
-- filter on these ("all guarantors accepted?", "what is awaiting verification?").
CREATE INDEX IF NOT EXISTS idx_loan_consents_role ON loan_consents (role);
CREATE INDEX IF NOT EXISTS idx_loan_consents_verification_status ON loan_consents (verification_status);

-- getConsentsForReview() now orders by responded_at and takes the newest 500.
CREATE INDEX IF NOT EXISTS idx_loan_consents_responded_at ON loan_consents (responded_at);

-- loan_message_templates.type — loanTemplateContext() reads templates by type on
-- every consent send, resend, OTP and disbursement notification.
CREATE INDEX IF NOT EXISTS idx_loan_message_templates_type ON loan_message_templates (type);

-- loan_guarantors.year + guarantor: the legacy fallback path (rows with no loan_id)
-- matches on Year + Loaner, and getUserProfile matches on guarantor.
-- idx_loan_guarantors_guarantor already exists from 2026-09-02/03; this covers the
-- composite lookup.
CREATE INDEX IF NOT EXISTS idx_loan_guarantors_year_loaner ON loan_guarantors (year, loaner);


-- ---------------------------------------------------------------------------
-- NOT INCLUDED, ON PURPOSE — uniqueness on loan_consents.consent_id and .token.
--
-- Both are minted per consent and must be unique; `token` in particular is a bearer
-- credential, and a collision would let one link resolve to another person's
-- consent. Until now they were generated with Date.now() + Math.random() (fixed in
-- audit C-4), so a historical collision is *possible* — and a UNIQUE index fails
-- outright if one exists. Check first, then apply:
--
--   SELECT consent_id, COUNT(*) c FROM loan_consents GROUP BY consent_id HAVING c > 1;
--   SELECT token,      COUNT(*) c FROM loan_consents GROUP BY token      HAVING c > 1;
--
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_consents_consent_id ON loan_consents (consent_id);
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_consents_token      ON loan_consents (token);
--
-- If either DOES return rows, that is itself a finding worth investigating before
-- adding the constraint.
-- ---------------------------------------------------------------------------
