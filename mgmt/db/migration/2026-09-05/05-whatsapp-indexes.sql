-- ============================================================================
-- Missing indexes — 2026-09-05  ·  DB: chhath-whatsapp-index     (audit H-10)
--
--   wrangler d1 execute chhath-whatsapp-index --remote --file=./migration/2026-09-05/05-whatsapp-indexes.sql
--
-- Idempotent (CREATE INDEX IF NOT EXISTS only). Nothing dropped, no row modified.
-- ============================================================================

-- The retention sweep (audit M-38) trims delivered/failed messages by sent_at, and
-- getStuckMessages() filters on status + created_at. status alone is already indexed
-- (schema/whatsapp_index.sql); these cover the composite predicates so neither the
-- sweep nor the stuck-message report ever scans the full message history.
CREATE INDEX IF NOT EXISTS idx_person_messages_status_sent_at ON person_messages (status, sent_at);
CREATE INDEX IF NOT EXISTS idx_group_messages_status_sent_at  ON group_messages  (status, sent_at);
CREATE INDEX IF NOT EXISTS idx_person_messages_created_at ON person_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_group_messages_created_at  ON group_messages  (created_at);

-- The template tables are read on every collection save (templatesForContribution)
-- and filter on contribution_type.
CREATE INDEX IF NOT EXISTS idx_person_message_templates_contribution_type ON person_message_templates (contribution_type);
CREATE INDEX IF NOT EXISTS idx_group_message_templates_contribution_type  ON group_message_templates  (contribution_type);
