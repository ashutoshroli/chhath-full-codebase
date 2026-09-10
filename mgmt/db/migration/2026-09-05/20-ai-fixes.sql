-- ============================================================================
-- ai_fixes table — 2026-09-05  ·  DB: chhath-logs (DB_LOGS)
--
--   wrangler d1 execute chhath-logs --remote --file=./migration/2026-09-05/20-ai-fixes.sql
--
-- Adds the ai_fixes table that tracks each "Fix using AI" run against an
-- error_log entry (lifecycle: pending -> fix_generated -> pr_created -> ...).
--
-- IDEMPOTENT: every statement is CREATE ... IF NOT EXISTS, so it applies cleanly
-- against a fresh DB built from schema/logs.sql (which already defines the table)
-- and a second run is a no-op. No data is ever deleted or altered. No PII — the
-- table holds code diffs, PR metadata and Claude token counts only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fix_id TEXT,
  error_id TEXT,
  status TEXT,
  model TEXT,
  diff TEXT,
  reasoning TEXT,
  files_json TEXT,
  branch TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  attempts INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error_message TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_fixes_fix_id ON ai_fixes(fix_id);
CREATE INDEX IF NOT EXISTS idx_ai_fixes_error_id ON ai_fixes(error_id);
CREATE INDEX IF NOT EXISTS idx_ai_fixes_status ON ai_fixes(status);
