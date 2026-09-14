-- ============================================================================
-- RESET PORTAL DATA — SECTION 5 of 8
-- database: chhath-whatsapp-index  (binding DB_WHATSAPP_INDEX)
--
--   npx wrangler d1 execute chhath-whatsapp-index --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/05-whatsapp-index.sql
--
-- KEEPS:
--   official_emails            KEPT ON REQUEST — the official mailbox is real
--                              correspondence, not test data
--   whatsapp_groups            configured group ids
--   person_message_templates   ┐
--   group_message_templates    ├ notification templates (configuration)
--   email_message_templates    ┘
--
-- EMPTIES (send queues): person_messages, group_messages, email_messages
--
-- These three are also clearable from the UI without SQL:
--   Superadmin -> Cleanup -> "WhatsApp messages" / "No-reply mails", mode "All".
--   The UI route deletes in bounded batches and writes an audit entry, so prefer
--   it when the backlog is large. This file is the equivalent, in one shot.
-- ============================================================================

DELETE FROM person_messages;
DELETE FROM sqlite_sequence WHERE name = 'person_messages';

DELETE FROM group_messages;
DELETE FROM sqlite_sequence WHERE name = 'group_messages';

DELETE FROM email_messages;
DELETE FROM sqlite_sequence WHERE name = 'email_messages';

-- ---------------------------------------------------------------- VERIFY
-- Expected: the three *_rows 0, every kept_* untouched.
SELECT
  (SELECT COUNT(*) FROM person_messages)          AS person_messages_rows,
  (SELECT COUNT(*) FROM group_messages)           AS group_messages_rows,
  (SELECT COUNT(*) FROM email_messages)           AS email_messages_rows,
  (SELECT COUNT(*) FROM official_emails)          AS kept_official_emails,
  (SELECT COUNT(*) FROM whatsapp_groups)          AS kept_whatsapp_groups,
  (SELECT COUNT(*) FROM person_message_templates) AS kept_person_templates,
  (SELECT COUNT(*) FROM group_message_templates)  AS kept_group_templates,
  (SELECT COUNT(*) FROM email_message_templates)  AS kept_email_templates;
