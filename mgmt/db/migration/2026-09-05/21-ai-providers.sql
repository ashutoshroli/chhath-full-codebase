-- ============================================================================
-- ai_providers table — 2026-09-05  ·  DB: chhath-logs (DB_LOGS)
--
--   wrangler d1 execute chhath-logs --remote --file=./migration/2026-09-05/21-ai-providers.sql
--
-- Stores the AI provider configs a Superadmin manages in the "AI Management"
-- tab (multiple providers, each with its own model/base URL and an ENCRYPTED
-- api key). is_default picks the one the AI-fix engine uses; none set -> falls
-- back to the ANTHROPIC_API_KEY Cloudflare secret.
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS, so it applies cleanly against a fresh DB
-- built from schema/logs.sql (which already defines the table) and a second run
-- is a no-op. No data deleted/altered. No PII. API keys are stored AES-GCM
-- encrypted (via AI_CONFIG_SECRET) — never plain text.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT,
  name TEXT,
  type TEXT,
  base_url TEXT,
  model TEXT,
  api_key_enc TEXT,
  key_hint TEXT,
  is_default INTEGER,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_provider_id ON ai_providers(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_default ON ai_providers(is_default);
