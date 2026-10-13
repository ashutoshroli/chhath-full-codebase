-- ============================================================================
-- Loan REPAID / UNDO REPAID notification templates — 2026-10-13
-- DB: chhath-loans-expenses
--
--   npx wrangler d1 execute chhath-loans-expenses --remote --file=mgmt/db/migration/2026-10-13/02-loan-repaid-templates.sql
--
-- markLoanRepaid() and undoLoanRepaid() notify the LOANER, every GUARANTOR and the
-- WhatsApp GROUPS, plus an email to the loaner and to each guarantor:
--
--   WhatsApp  repaid_group               repaid_undo_group
--             repaid_loaner_personal     repaid_undo_loaner_personal
--             repaid_guarantor_personal  repaid_undo_guarantor_personal
--   Email     repaid_loaner_personal     repaid_undo_loaner_personal
--             repaid_guarantor_personal  repaid_undo_guarantor_personal
--
-- Placeholders: {LoanerName} {LoanerNameHindi} {Name} {NameHindi} {Year} {Amount}
--   {InterestRate} {Tenure} {InterestAmount} {TotalAmount} {CashAmount}
--   {OnlineAmount} {RepaidDate} {Guarantor1} {Guarantor2} {Guarantor3}
--   ({Name} is the person the message is addressed to.)
--
-- The text is a STARTING POINT — every row is editable in mgmt → WhatsApp / Email
-- Templates.
--
-- IDEMPOTENT: each INSERT is guarded by NOT EXISTS on its `type`, so re-running
-- changes nothing and never overwrites text the committee has since edited.
-- ============================================================================

-- ---------------------------------------------------------------- WhatsApp: REPAID
INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_REPAID_GROUP', 'repaid_group',
  'चट्ठ पूजा समिति — ऋण वापसी' || char(10) ||
  'Loan {Year} · {LoanerName}' || char(10) || char(10) ||
  'मूलधन {Amount} + ब्याज {InterestAmount} = कुल {TotalAmount} पूरा वापस मिल गया है।' || char(10) ||
  'नकद {CashAmount} · ऑनलाइन {OnlineAmount} · दिनांक {RepaidDate}',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'repaid_group');

INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_REPAID_LOANER', 'repaid_loaner_personal',
  'नमस्ते {LoanerName},' || char(10) || char(10) ||
  'आपका ऋण ({Year}) पूरा चुका दिया गया है — धन्यवाद।' || char(10) ||
  'मूलधन {Amount} + ब्याज {InterestAmount} = कुल {TotalAmount}' || char(10) ||
  'नकद {CashAmount} · ऑनलाइन {OnlineAmount} · दिनांक {RepaidDate}' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'repaid_loaner_personal');

INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_REPAID_GUARANTOR', 'repaid_guarantor_personal',
  'नमस्ते {Name},' || char(10) || char(10) ||
  '{LoanerName} का ऋण ({Year}), जिसके आप गारंटर थे, पूरा चुका दिया गया है (कुल {TotalAmount}, दिनांक {RepaidDate})।' || char(10) ||
  'अब आप इस ऋण की गारंटी से मुक्त हैं। धन्यवाद।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'repaid_guarantor_personal');

-- ----------------------------------------------------------- WhatsApp: UNDO REPAID
INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_REPAID_UNDO_GROUP', 'repaid_undo_group',
  'चट्ठ पूजा समिति — सुधार' || char(10) ||
  'Loan {Year} · {LoanerName}' || char(10) || char(10) ||
  'इस ऋण को "चुकाया गया" गलती से दर्ज हुआ था; इसे हटा दिया गया है। ऋण अभी बकाया है (कुल {TotalAmount})।',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'repaid_undo_group');

INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_REPAID_UNDO_LOANER', 'repaid_undo_loaner_personal',
  'नमस्ते {LoanerName},' || char(10) || char(10) ||
  'आपके ऋण ({Year}) की वापसी की प्रविष्टि सुधार के लिए हटा दी गई है। रिकॉर्ड में ऋण अभी बकाया है (कुल {TotalAmount})।' || char(10) ||
  'कोई प्रश्न हो तो कृपया समिति से संपर्क करें।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'repaid_undo_loaner_personal');

INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link)
SELECT 'TPL_REPAID_UNDO_GUARANTOR', 'repaid_undo_guarantor_personal',
  'नमस्ते {Name},' || char(10) || char(10) ||
  '{LoanerName} के ऋण ({Year}) की वापसी की प्रविष्टि सुधार के लिए हटा दी गई है। रिकॉर्ड में ऋण अभी बकाया है, इसलिए आपकी गारंटी अभी जारी है।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_message_templates WHERE type = 'repaid_undo_guarantor_personal');

-- ------------------------------------------------------------------- Email: REPAID
INSERT INTO loan_email_templates (template_id, type, subject, text, active, created_at, message_type, file_link)
SELECT 'TPLE_REPAID_LOANER', 'repaid_loaner_personal',
  'आपका ऋण पूरा चुका दिया गया है ({Year})',
  'नमस्ते {LoanerName},' || char(10) || char(10) ||
  'आपका ऋण ({Year}) पूरा चुका दिया गया है — धन्यवाद।' || char(10) ||
  'मूलधन {Amount} + ब्याज {InterestAmount} = कुल {TotalAmount}' || char(10) ||
  'नकद {CashAmount} · ऑनलाइन {OnlineAmount} · दिनांक {RepaidDate}' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_email_templates WHERE type = 'repaid_loaner_personal');

INSERT INTO loan_email_templates (template_id, type, subject, text, active, created_at, message_type, file_link)
SELECT 'TPLE_REPAID_GUARANTOR', 'repaid_guarantor_personal',
  'गारंटी से मुक्ति — {LoanerName} का ऋण चुका दिया गया ({Year})',
  'नमस्ते {Name},' || char(10) || char(10) ||
  '{LoanerName} का ऋण ({Year}), जिसके आप गारंटर थे, पूरा चुका दिया गया है (कुल {TotalAmount}, दिनांक {RepaidDate})।' || char(10) ||
  'अब आप इस ऋण की गारंटी से मुक्त हैं। धन्यवाद।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_email_templates WHERE type = 'repaid_guarantor_personal');

-- -------------------------------------------------------------- Email: UNDO REPAID
INSERT INTO loan_email_templates (template_id, type, subject, text, active, created_at, message_type, file_link)
SELECT 'TPLE_REPAID_UNDO_LOANER', 'repaid_undo_loaner_personal',
  'सुधार — आपके ऋण की वापसी की प्रविष्टि हटाई गई ({Year})',
  'नमस्ते {LoanerName},' || char(10) || char(10) ||
  'आपके ऋण ({Year}) की वापसी की प्रविष्टि सुधार के लिए हटा दी गई है। रिकॉर्ड में ऋण अभी बकाया है (कुल {TotalAmount})।' || char(10) ||
  'कोई प्रश्न हो तो कृपया समिति से संपर्क करें।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_email_templates WHERE type = 'repaid_undo_loaner_personal');

INSERT INTO loan_email_templates (template_id, type, subject, text, active, created_at, message_type, file_link)
SELECT 'TPLE_REPAID_UNDO_GUARANTOR', 'repaid_undo_guarantor_personal',
  'सुधार — {LoanerName} के ऋण की वापसी की प्रविष्टि हटाई गई ({Year})',
  'नमस्ते {Name},' || char(10) || char(10) ||
  '{LoanerName} के ऋण ({Year}) की वापसी की प्रविष्टि सुधार के लिए हटा दी गई है। रिकॉर्ड में ऋण अभी बकाया है, इसलिए आपकी गारंटी अभी जारी है।' || char(10) || char(10) ||
  '— चट्ठ पूजा समिति',
  '1', datetime('now'), 'normal', ''
WHERE NOT EXISTS (SELECT 1 FROM loan_email_templates WHERE type = 'repaid_undo_guarantor_personal');
