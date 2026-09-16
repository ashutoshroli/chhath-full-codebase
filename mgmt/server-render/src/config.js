// Boot-time env validation for the Render offload service. Fail fast (and loud)
// if a required secret/var is missing, so a misconfigured deploy is obvious in the
// logs rather than surfacing as a mysterious 401/500 on the first job.

function req(name) {
  const v = process.env[name];
  if (!v || !v.toString().trim()) {
    throw new Error(`Missing required env var: ${name} (set it in the Render dashboard → Environment)`);
  }
  return v.toString();
}
function opt(name, fallback = '') {
  const v = process.env[name];
  return v && v.toString().trim() ? v.toString() : fallback;
}

// Retention is the one setting where the safe fallback is NOT zero: 0 means "keep every
// chat log for ever", so a value that does not parse must not quietly become that. An
// unset variable takes the default; a set-but-unparseable one takes the default AND says
// so, because that is a misconfiguration somebody needs to see.
export const DEFAULT_CHAT_RETENTION_DAYS = 90;

export function retentionDays(raw) {
  if (raw === '' || raw === undefined || raw === null) return DEFAULT_CHAT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(
      `[config] CHAT_RETENTION_DAYS="${raw}" is not a number of days; ` +
      `using the default of ${DEFAULT_CHAT_RETENTION_DAYS}. Set it to 0 to keep chat logs for ever.`
    );
    return DEFAULT_CHAT_RETENTION_DAYS;
  }
  return Math.floor(n);
}

export const config = {
  // Shared secrets (two DISTINCT values — see README).
  renderApiKey: req('RENDER_API_KEY'),               // incoming Worker->Render auth (X-Render-Api-Key)
  renderWebhookSecret: req('RENDER_WEBHOOK_SECRET'),  // outgoing Render->Worker auth (X-Render-Signature)

  // Where to POST job results back to.
  workerWebhookUrl: req('WORKER_WEBHOOK_URL'),        // e.g. https://<worker-host>/?render-webhook=1

  // GitHub (Render does the repo reads/writes itself).
  githubToken: req('GITHUB_TOKEN'),
  githubRepo: req('GITHUB_REPO'),                     // "owner/repo"

  // AI model config. ANTHROPIC_API_KEY is the default provider; AI_FIX_MODEL is
  // overridable. (Only the Anthropic path is supported here for the initial
  // rollout — the Worker's multi-provider config stays Worker-side.)
  anthropicApiKey: req('ANTHROPIC_API_KEY'),
  aiFixModel: opt('AI_FIX_MODEL', 'claude-sonnet-4-5-20250929'),

  // Google Drive OAuth (for the pdf_convert job — bulk PDF offload). Optional:
  // an AI-only deploy doesn't need them; the pdf_convert job fails clearly if
  // they're missing. Same creds/refresh-token the Worker uses.
  driveOAuthClientId: opt('DRIVE_OAUTH_CLIENT_ID', ''),
  driveOAuthClientSecret: opt('DRIVE_OAUTH_CLIENT_SECRET', ''),
  driveOAuthRefreshToken: opt('DRIVE_OAUTH_REFRESH_TOKEN', ''),

  // ---- Public chatbot (/public-chat endpoint) ----
  // Base URL of the PUBLIC portal Worker (the same host the public frontend calls).
  // The chatbot fetches the already-cached ?action=dataVersion + ?action=portalData
  // from here, so it reads the edge cache and never touches D1 directly.
  publicApiBase: opt('PUBLIC_API_BASE', 'https://chhath-public-worker.shaharpura.com'),
  // Base URL of the mgmt Worker (to fetch the public_chat provider via the
  // Render-only ?render-provider route). Falls back to deriving from workerWebhookUrl.
  mgmtApiBase: opt('MGMT_API_BASE', ''),
  // Comma-separated EXACT browser origins allowed to call /public-chat (CORS +
  // Origin check). The public site + localhost for dev by default.
  chatAllowedOrigins: opt('CHAT_ALLOWED_ORIGINS', 'https://chhath.shaharpura.com,http://localhost:5173,http://localhost:3000'),
  // Per-IP rate limit for /public-chat (requests per window).
  chatRateMax: parseInt(opt('CHAT_RATE_MAX', '15'), 10) || 15,
  chatRateWindowMs: parseInt(opt('CHAT_RATE_WINDOW_MS', '60000'), 10) || 60000,
  // How many proxies sit between this service and the caller. The client IP is read from
  // the RIGHT of X-Forwarded-For by this many hops, because the left-hand entries are
  // client-supplied (audit Render/offload #8). Render puts exactly one proxy in front.
  chatTrustedProxyHops: parseInt(opt('CHAT_TRUSTED_PROXY_HOPS', '1'), 10) || 1,
  // Absolute ceilings for an anonymous endpoint where every request costs money. The per-IP
  // window catches one greedy caller; these catch the total.
  chatMaxConcurrent: parseInt(opt('CHAT_MAX_CONCURRENT', '4'), 10) || 4,
  chatDailyTokenBudget: parseInt(opt('CHAT_DAILY_TOKEN_BUDGET', '200000'), 10) || 200000,
  // How long a public chat log is kept. What is stored is the visitor's own words plus a
  // pseudonym linking the conversation to a person, so this is a privacy commitment, not
  // housekeeping — schema.sql used to describe it as "optional".
  //
  // NOT `parseInt(...) || 0`, which is the obvious spelling and the wrong one here: with
  // it, a typo (`CHAT_RETENTION_DAYS=ninety`) parses to NaN, falls to 0, and 0 means KEEP
  // EVERYTHING FOR EVER. A misspelling would silently switch retention off and look
  // exactly like a working deployment. Keeping everything has to be typed deliberately,
  // so an unparseable value falls back to the default and says so.
  chatRetentionDays: retentionDays(opt('CHAT_RETENTION_DAYS', '')),
  // How many offload jobs may run at once on one instance, and how long any single job may
  // hold its slot. A free-tier instance has one CPU and 512 MB, and a provider that never
  // answers used to hold a job forever (audit Render/offload #3, #5).
  jobsMaxConcurrent: parseInt(opt('JOBS_MAX_CONCURRENT', '3'), 10) || 3,
  // 10 minutes: deliberately just UNDER the Worker's own ten-minute reconcile window, so a
  // job that is going to fail says so before the Worker decides to re-dispatch it.
  jobDeadlineMs: parseInt(opt('JOB_DEADLINE_MS', '570000'), 10) || 570000,
  // audit Render/offload #9. The IP pseudonym stored with chat logs is an HMAC keyed on this
  // secret. UNSET means no pseudonym is stored at all — deliberately, because an unsalted hash
  // of an IPv4 address is 2^32 candidates and therefore not a pseudonym.
  chatIpHashSecret: opt('CHAT_IP_HASH_SECRET', ''),
  // Signs the chat session id, so a client cannot write into someone else's session history.
  // Falls back to the IP-hash secret, then to the webhook secret this service already holds,
  // so the protection is on by default rather than waiting for configuration.
  chatSessionSecret: opt('CHAT_SESSION_SECRET', '') || opt('CHAT_IP_HASH_SECRET', '') || opt('RENDER_WEBHOOK_SECRET', ''),
  // Escape hatch for Neon TLS verification. Named for what it is so nobody turns it off by
  // accident, or leaves it off without having typed the reason. Neon serves a publicly-trusted
  // certificate, so this should never be needed.
  neonAllowUnverifiedTls: opt('NEON_ALLOW_UNVERIFIED_TLS', '') === '1',
  // Neon Postgres connection string for chat logs. OPTIONAL — if unset, the
  // chatbot still answers and just skips logging.
  databaseUrl: opt('DATABASE_URL', ''),

  port: parseInt(opt('PORT', '10000'), 10) || 10000,
};

// Validate GITHUB_REPO shape early.
if (!/^[\w.-]+\/[\w.-]+$/.test(config.githubRepo)) {
  throw new Error('GITHUB_REPO must be "owner/repo"');
}
