-- ============================================================================
-- Audit fix migration — 2026-09-01
--
-- Run each block against the DB named in its header, e.g.
--   wrangler d1 execute chhath-file-index      --remote --file=./migration/2026-09-01-audit-fixes.sql
-- (the file is split by DB below. Run only the block for the DB you target, or
--  split it into per-DB files first — D1 executes one database at a time).
--
-- Every statement here is IDEMPOTENT (IF NOT EXISTS / guarded) so re-running is
-- safe. Nothing drops or rewrites existing data.
--
-- Fixes: B4 (duplicate generated_files rows), W-B2 (group template columns
-- missing), W-B3/W-B5/W-B13/W-B14 (queue has no claim/attempt/uniqueness),
-- W-B7 (phone stored as REAL), E-B13 (reported flag 'False' vs 0), E-B19
-- (created_at format), docx_templates duplicate rows.
-- ============================================================================


-- ============================================================================
-- DB: chhath-file-index
-- ============================================================================

-- B4: generated_files had NO unique constraint, so the read-then-write guard in
-- convertDocxToPdf() was a pure race — two concurrent requests both converted
-- and both inserted. A partial UNIQUE INDEX gives the DB the last word and lets
-- the code use INSERT ... ON CONFLICT.
-- Clean up any duplicates that already accumulated (keep the newest row).
DELETE FROM generated_files
WHERE id NOT IN (
  SELECT MAX(id) FROM generated_files GROUP BY doc_type, year, record_id
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_files_doc_year_record
  ON generated_files (doc_type, year, record_id);


-- ============================================================================
-- DB: chhath-templates
-- ============================================================================

-- docx_templates upload/copy used SELECT-then-INSERT with no constraint, so two
-- concurrent uploads could create two rows for the same (doc_type, year) and
-- getDocxTemplate()'s .first() would then pick one arbitrarily.
DELETE FROM docx_templates
WHERE id NOT IN (SELECT MAX(id) FROM docx_templates GROUP BY doc_type, year);

CREATE UNIQUE INDEX IF NOT EXISTS uq_docx_templates_type_year
  ON docx_templates (doc_type, year);


-- ============================================================================
-- DB: chhath-whatsapp-index
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


-- ============================================================================
-- DB: chhath-logs
-- ============================================================================

-- E-B13: the sheet migration wrote reported='False'/'True' but the code does
-- `UPDATE ... WHERE reported = 0`, so for all 234 legacy rows meta.changes was
-- always 0 -> reportErrorToWhatsApp() returned alreadyReported and sent NOTHING,
-- while isTruthyFlag('False') was false so the button kept re-appearing.
-- Silent, repeatable no-op. Normalize to '0'/'1'.
UPDATE error_log SET reported = '1' WHERE LOWER(TRIM(CAST(reported AS TEXT))) IN ('true','yes','1');
UPDATE error_log SET reported = '0' WHERE reported IS NULL
   OR LOWER(TRIM(CAST(reported AS TEXT))) IN ('false','no','0','');

-- B3: rows written by the old docxTemplates.js INSERT are missing error_id
-- entirely, which made them un-reportable (report(null) -> "Error record nahi
-- mila.") and gave React duplicate null keys. Backfill a synthetic id.
UPDATE error_log
SET error_id = 'ERRFIX' || CAST(id AS TEXT)
WHERE error_id IS NULL OR TRIM(error_id) = '';

-- E-B19: created_at was written in two formats ('2026-08-11 00:57:19' from the
-- sheet migration vs ISO '2026-08-11T00:57:19.000Z' from logError), and
-- `ORDER BY created_at DESC` is a lexicographic TEXT sort — so ordering across
-- the two was not reliable. Convert the legacy space-separated form to ISO.
UPDATE error_log
SET created_at = REPLACE(created_at, ' ', 'T') || 'Z'
WHERE created_at LIKE '____-__-__ __:__:__';

CREATE UNIQUE INDEX IF NOT EXISTS uq_error_log_error_id ON error_log (error_id);

-- E-B16: no retention policy existed at all — error_log grew without bound and
-- the only cap was the 300-row read window. Trim anything older than 180 days
-- that has already been reported (or was never worth reporting).
DELETE FROM error_log
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 days');
