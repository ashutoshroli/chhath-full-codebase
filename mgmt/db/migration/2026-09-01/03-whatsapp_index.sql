-- ============================================================================
-- Audit fix migration — 2026-09-01  ·  DB: chhath-whatsapp-index
--
-- RUN THIS FILE AGAINST **chhath-whatsapp-index** ONLY:
--   wrangler d1 execute chhath-whatsapp-index --remote --file=./migration/2026-09-01/03-whatsapp_index.sql
--
-- Test it locally first (safe, hits the local replica, not production):
--   wrangler d1 execute chhath-whatsapp-index --local --file=./migration/2026-09-01/03-whatsapp_index.sql
--
-- ⚠️ RUN THIS FILE ONCE.
-- SQLite has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", so if you run this
-- file a SECOND time the 8 ALTER TABLE statements below will report
--     "duplicate column name: doc_sub_type"   (etc.)
-- That error is HARMLESS — it only means the column is already there. Nothing is
-- corrupted. Everything else in this file (CREATE ... IF NOT EXISTS, UPDATE) is
-- fully idempotent.
--
-- Nothing here drops a table or deletes live records.
--
-- This file was split out of 2026-09-01-audit-fixes.sql, which contains all four
-- DB blocks in one file — convenient to read, but you CANNOT pipe that combined
-- file into a single database.
-- ============================================================================

-- W-B2: addTemplate()/updateTemplate() always write doc_sub_type + file_doc_type
-- for BOTH template tables, but group_message_templates never had those two
-- columns -> every "Add/Update Group Template" returned D1_ERROR:
--   "table group_message_templates has no column named doc_sub_type"
-- Both columns are genuinely used for group messages too (doc_sub_type picks
-- Certificate-vs-Receipt in templatesForContribution(), file_doc_type decides
-- whether the freshly generated PDF gets attached in resolveFileLink()).
ALTER TABLE group_message_templates ADD COLUMN doc_sub_type TEXT;
ALTER TABLE group_message_templates ADD COLUMN file_doc_type TEXT;

-- W-B13: message_id is the sole business key used by updateMessageStatus() and
-- resendMessage(), but nothing enforced uniqueness — a collision would make
-- UPDATE ... WHERE message_id = ? hit multiple rows (silent cross-recipient
-- status corruption).
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_messages_message_id
  ON person_messages (message_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_messages_message_id
  ON group_messages (message_id);

-- W-B3 / W-B5 / W-B14: the "queue" had no claim/lease, no attempt counter and
-- no timestamps, so getPendingMessages() re-served the same rows on every poll
-- (duplicate sends) and a row stuck in 'pending'/'resending' was invisible and
-- unrecoverable forever.
--   attempts      — how many times the row has been served to the sender
--   claimed_at    — set when served. A stale claim is automatically re-queued
--   sent_at       — set on the terminal sent/failed transition
ALTER TABLE person_messages ADD COLUMN attempts INTEGER DEFAULT 0;
ALTER TABLE person_messages ADD COLUMN claimed_at TEXT;
ALTER TABLE person_messages ADD COLUMN sent_at TEXT;
ALTER TABLE group_messages  ADD COLUMN attempts INTEGER DEFAULT 0;
ALTER TABLE group_messages  ADD COLUMN claimed_at TEXT;
ALTER TABLE group_messages  ADD COLUMN sent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_person_messages_claimed_at ON person_messages (claimed_at);
CREATE INDEX IF NOT EXISTS idx_group_messages_claimed_at  ON group_messages  (claimed_at);

-- W-B7: normalize the mixed phone formats that the four different (now removed)
-- normalizers left behind — the same column currently holds both `7282032146`
-- and `917282032146`, plus REAL-affinity artefacts like `917282032146.0`.
-- After this, every stored recipient is the canonical `91XXXXXXXXXX`.
UPDATE person_messages
SET mobileno = REPLACE(CAST(mobileno AS TEXT), '.0', '')
WHERE CAST(mobileno AS TEXT) LIKE '%.0';

UPDATE person_messages
SET mobileno = '91' || CAST(mobileno AS TEXT)
WHERE LENGTH(CAST(mobileno AS TEXT)) = 10
  AND CAST(mobileno AS TEXT) GLOB '[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';

UPDATE person_messages
SET "from" = REPLACE(CAST("from" AS TEXT), '.0', '')
WHERE CAST("from" AS TEXT) LIKE '%.0';

UPDATE group_messages
SET "from" = REPLACE(CAST("from" AS TEXT), '.0', '')
WHERE CAST("from" AS TEXT) LIKE '%.0';

-- W-B19: the `active` flag is a TEXT column that ended up holding both 'True'
-- (from the sheet migration) and '1' (from portal writes). isTruthyFlag() now
-- tolerates both, but normalize anyway so the data itself is unambiguous.
UPDATE whatsapp_groups          SET active = '1' WHERE LOWER(TRIM(CAST(active AS TEXT))) IN ('true','yes','1');
UPDATE whatsapp_groups          SET active = '0' WHERE LOWER(TRIM(CAST(active AS TEXT))) IN ('false','no','0','');
UPDATE group_message_templates  SET active = '1' WHERE LOWER(TRIM(CAST(active AS TEXT))) IN ('true','yes','1');
UPDATE group_message_templates  SET active = '0' WHERE LOWER(TRIM(CAST(active AS TEXT))) IN ('false','no','0','');
UPDATE person_message_templates SET active = '1' WHERE LOWER(TRIM(CAST(active AS TEXT))) IN ('true','yes','1');
UPDATE person_message_templates SET active = '0' WHERE LOWER(TRIM(CAST(active AS TEXT))) IN ('false','no','0','');
