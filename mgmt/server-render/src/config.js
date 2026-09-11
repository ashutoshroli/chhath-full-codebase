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

  port: parseInt(opt('PORT', '10000'), 10) || 10000,
};

// Validate GITHUB_REPO shape early.
if (!/^[\w.-]+\/[\w.-]+$/.test(config.githubRepo)) {
  throw new Error('GITHUB_REPO must be "owner/repo"');
}
