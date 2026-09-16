-- ============================================================================
-- Consent DECLINED / REJECTED notification templates — DB: chhath-loans-expenses
--
--   wrangler d1 execute chhath-loans-expenses --remote --file=./migration/2026-09-05/32-consent-decline-templates.sql
--
-- WHY (reported by the committee from live use, tracked as C14):
--
--   respondConsent() notified only on 'accepted'; the 'declined' branch wrote
--   decline_remarks and returned. setConsentVerification() likewise notified only
--   on 'verified'. So when a guarantor refused, or the committee rejected a
--   verification, NOBODY WAS TOLD:
--
--     * the loaner was never informed his loan had stopped — he simply waited on a
--       process that was already over;
--     * the committee got no message either;
--     * and the remarks the decliner is FORCED to write
--       ('Remarks are required in order to Decline.') went nowhere a person sees,
--       unless someone happened to open the Consent Review screen.
--
-- Recipients were decided with the committee: THE LOANER AND THE GROUP.
--
-- One judgement call is encoded in the default text below rather than left to the
-- code: the raw remark goes to the GROUP message only. The loaner is told that it
-- was declined and by whom. A decline remark can be blunt about the person it
-- concerns, and forwarding it to him verbatim should be a deliberate editorial
-- choice — so it is one line to add {DeclineRemarks} to the loaner template in the
-- Templates screen if the committee wants that.
--
-- The text is a STARTING POINT. Every row is editable in mgmt → WhatsApp/Email
-- Templates, and the committee is expected to reword it in their own voice.
--
-- IDEMPOTENT: each INSERT is guarded by NOT EXISTS on its `type`, so re-running
-- changes nothing — and, importantly, will NOT overwrite text the committee has
-- since edited. Nothing is dropped, nothing deleted, no row modified.
-- ============================================================================

-- loan_email_templates is created by migration 16 and is NOT in the committed
-- schema file, so this migration creates it if absent to stay self-sufficient.
CREATE TABLE IF NOT EXISTS loan_email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT,
  type TEXT,
  subject TEXT,
  text TEXT,
  active TEXT,
  created_at TEXT,
  message_type TEXT,
  file_link TEXT
);
CREATE INDEX IF NOT EXISTS idx_loan_email_templates_type ON loan_email_templates(type);

-- ---------------------------------------------------------------- WhatsApp: group
-- The group is the committee's own channel, so this is the message that carries the
-- reason. {Name} is the person who declined; {Role} says whether that was the
-- loaner or a guarantor.
INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_CONSENT_DECLINED_GROUP', 'consent_declined_group',
  'चट्ठ पूजा समिति — ऋण सहमति अस्वीकृत' || char(10) ||
  'Loan {Year} · {LoanerName} · राशि {Amount}' || char(10) || char(10) ||
  '{Name} ({Role}) ने सहमति देने से इनकार कर दिया है।' || char(10) ||
  'कारण: {DeclineRemarks}' || char(10) || char(10) ||
  'यह ऋण अभी आगे नहीं बढ़ेगा। कृपया समिति में निर्णय लें।',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'consent_declined_group');

INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_CONSENT_REJECTED_GROUP', 'consent_rejected_group',
  'चट्ठ पूजा समिति — सहमति सत्यापन अस्वीकृत' || char(10) ||
  'Loan {Year} · {LoanerName} · राशि {Amount}' || char(10) || char(10) ||
  '{Name} ({Role}) की सहमति सत्यापन में अस्वीकृत कर दी गई है।' || char(10) || char(10) ||
  'यह ऋण अभी आगे नहीं बढ़ेगा। कृपया समिति में निर्णय लें।',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'consent_rejected_group');

-- --------------------------------------------------------------- WhatsApp: loaner
-- Deliberately WITHOUT {DeclineRemarks} — see the note at the top. It tells him the
-- one thing he could not otherwise find out: that his loan has stopped, and who to
-- talk to about it.
INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_CONSENT_DECLINED_LOANER', 'consent_declined_loaner_personal',
  'नमस्ते {LoanerName},' || char(10) || char(10) ||
  'आपके ऋण आवेदन ({Year}, राशि {Amount}) के लिए {Name} ({Role}) ने सहमति देने से इनकार कर दिया है।' || char(10) || char(10) ||
  'इसलिए यह आवेदन अभी आगे नहीं बढ़ पाएगा। आगे क्या करना है, यह जानने के लिए कृपया समिति से संपर्क करें।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'consent_declined_loaner_personal');

INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_CONSENT_REJECTED_LOANER', 'consent_rejected_loaner_personal',
  'नमस्ते {LoanerName},' || char(10) || char(10) ||
  'आपके ऋण आवेदन ({Year}, राशि {Amount}) में {Name} ({Role}) की सहमति सत्यापन में अस्वीकृत कर दी गई है।' || char(10) || char(10) ||
  'इसलिए यह आवेदन अभी आगे नहीं बढ़ पाएगा। कृपया समिति से संपर्क करें।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'consent_rejected_loaner_personal');

-- ------------------------------------------------------------------ Email: loaner
-- The email mirror is an independent template and channel, exactly as the accepted
-- path already works, so a loaner with an email address but no WhatsApp is still told.
INSERT INTO loan_email_templates (template_id, type, subject, text, active, created_at, message_type, file_link)
SELECT 'TPLE_CONSENT_DECLINED_LOANER', 'consent_declined_loaner_personal',
  'आपका ऋण आवेदन आगे नहीं बढ़ सका — सहमति अस्वीकृत ({Year})',
  'नमस्ते {LoanerName},' || char(10) || char(10) ||
  'आपके ऋण आवेदन ({Year}, राशि {Amount}) के लिए {Name} ({Role}) ने सहमति देने से इनकार कर दिया है।' || char(10) || char(10) ||
  'इसलिए यह आवेदन अभी आगे नहीं बढ़ पाएगा। आगे क्या करना है, यह जानने के लिए कृपया समिति से संपर्क करें।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_email_templates WHERE type = 'consent_declined_loaner_personal');

INSERT INTO loan_email_templates (template_id, type, subject, text, active, created_at, message_type, file_link)
SELECT 'TPLE_CONSENT_REJECTED_LOANER', 'consent_rejected_loaner_personal',
  'आपका ऋण आवेदन आगे नहीं बढ़ सका — सत्यापन अस्वीकृत ({Year})',
  'नमस्ते {LoanerName},' || char(10) || char(10) ||
  'आपके ऋण आवेदन ({Year}, राशि {Amount}) में {Name} ({Role}) की सहमति सत्यापन में अस्वीकृत कर दी गई है।' || char(10) || char(10) ||
  'इसलिए यह आवेदन अभी आगे नहीं बढ़ पाएगा। कृपया समिति से संपर्क करें।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_email_templates WHERE type = 'consent_rejected_loaner_personal');
