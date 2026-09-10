-- D1 database: logs
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "ERROR_LOG"
DROP TABLE IF EXISTS error_log;
CREATE TABLE error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_id TEXT,
  source TEXT,
  page TEXT,
  message TEXT,
  stack TEXT,
  context TEXT,
  created_at TEXT,
  reported TEXT
);
CREATE INDEX idx_error_log_created_at ON error_log(created_at);
CREATE INDEX idx_error_log_reported ON error_log(reported);

-- source sheet: "ACTIVITY LOG"
DROP TABLE IF EXISTS activity_log;
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT,
  name TEXT,
  action TEXT,
  details TEXT,
  device_info TEXT,
  ip_client_reported TEXT,
  device_id TEXT
);
CREATE INDEX idx_activity_log_name ON activity_log(name);

-- AI auto-fix jobs. One row per "Fix using AI" run against an error_log entry.
-- Tracks the whole lifecycle: pending -> fix_generated -> pr_created -> ci_running
-- -> ci_passed / ci_failed (retry N/3) -> merged / needs_manual_review / failed.
-- Lives in the logs DB next to error_log (the data it is about). No PII: it holds
-- code diffs, PR metadata, and Claude token counts for cost tracking.
CREATE TABLE IF NOT EXISTS ai_fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fix_id TEXT,                 -- opaque id, e.g. 'AIF<hex>'
  error_id TEXT,               -- the error_log.error_id this fix targets
  status TEXT,                 -- pending | fix_generated | pr_created | ci_running | ci_passed | ci_failed | merged | needs_manual_review | failed
  model TEXT,                  -- Claude model used
  diff TEXT,                   -- the unified diff Claude proposed (latest attempt)
  reasoning TEXT,              -- Claude's short summary of the fix
  files_json TEXT,             -- JSON: [{ path, sha }] the files sent as context (paths only, never secrets)
  branch TEXT,                 -- fix/error-<error_id>
  pr_number INTEGER,           -- GitHub PR number (set in PR-2)
  pr_url TEXT,                 -- GitHub PR html_url
  attempts INTEGER,            -- CI retry attempts used (0..3), driven in PR-3
  prompt_tokens INTEGER,       -- cumulative Claude input tokens (cost tracking)
  completion_tokens INTEGER,   -- cumulative Claude output tokens
  error_message TEXT,          -- last failure reason, if any
  created_by TEXT,             -- Superadmin who triggered it
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_fixes_fix_id ON ai_fixes(fix_id);
CREATE INDEX IF NOT EXISTS idx_ai_fixes_error_id ON ai_fixes(error_id);
CREATE INDEX IF NOT EXISTS idx_ai_fixes_status ON ai_fixes(status);

-- AI provider configs for the "AI Management" tab. Multiple providers, each with
-- its own model + base URL + ENCRYPTED api key (AES-GCM via AI_CONFIG_SECRET —
-- never plain text). is_default picks the one the AI-fix engine uses; with none
-- set it falls back to the ANTHROPIC_API_KEY Cloudflare secret. No PII.
CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT,
  name TEXT,                   -- display name, e.g. "OpenAI GPT-4o"
  type TEXT,                   -- 'anthropic' | 'openai-compatible'
  base_url TEXT,               -- for openai-compatible, e.g. https://api.openai.com/v1
  model TEXT,                  -- e.g. gpt-4o, claude-sonnet-4-5, google/gemini-2.0-flash
  api_key_enc TEXT,            -- AES-GCM ciphertext "v1:iv:ct" — NEVER plain text
  key_hint TEXT,               -- masked hint only, e.g. "••••••••1234"
  is_default INTEGER,          -- 1 = the provider the AI-fix engine uses
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_provider_id ON ai_providers(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_default ON ai_providers(is_default);

