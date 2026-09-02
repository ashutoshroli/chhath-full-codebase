// ============ DEPLOYMENT CONFIG VALIDATION + HEALTH CHECK ============
//
// Audit 4.1: required secrets / bindings used to be checked only LAZILY — the
// moment a given feature first touched them (Drive OAuth vars threw only when a
// PDF conversion ran; a missing D1 binding surfaced as a random 500 deep inside a
// handler). There was no single place to see "is this deployment fully wired?".
//
// This module gives:
//   * checkConfig(env)  — returns a structured report of every required binding /
//     var / secret and whether it is present. Never throws.
//   * healthCheck(env)  — a readiness probe that actually touches D1 + KV, so a
//     GET liveness call reports "degraded" when a dependency is down instead of a
//     cheerful "ok" while every database is unreachable (audit 3.3).
//
// It intentionally does NOT read secret VALUES (they're write-only in Workers);
// it only reports presence/absence, so it's safe to expose the boolean report.

// D1 bindings the mgmt Worker cannot run without.
const REQUIRED_D1 = [
  'DB_CORE', 'DB_COLLECTIONS', 'DB_LOANS_EXPENSES', 'DB_TEMPLATES',
  'DB_FILE_INDEX', 'DB_WHATSAPP_INDEX', 'DB_LOGS', 'DB_MISC',
];
// Other required bindings.
const REQUIRED_BINDINGS = ['KV_SESSIONS'];
// Secrets / vars. Some are only needed for specific features, so they are split
// into "hard" (auth/session correctness breaks without them) and "feature" (a
// specific capability degrades, but the core portal still runs).
const REQUIRED_SECRETS = ['PASSWORD_SALT'];
const FEATURE_SECRETS = [
  'WHATSAPP_QUEUE_API_KEY',
  'DRIVE_FOLDER_ID', 'DRIVE_ROOT_FOLDER_ID',
  'DRIVE_OAUTH_CLIENT_ID', 'DRIVE_OAUTH_CLIENT_SECRET', 'DRIVE_OAUTH_REFRESH_TOKEN',
];
const REQUIRED_VARS = ['CONSENT_BASE_URL'];

function present(v) {
  return !(v === undefined || v === null || v.toString().trim() === '');
}

// Returns { ok, missing: {d1, bindings, secrets, vars}, featureWarnings } without
// ever throwing or leaking a secret value.
export function checkConfig(env) {
  const missing = { d1: [], bindings: [], secrets: [], vars: [] };
  const featureWarnings = [];

  for (const b of REQUIRED_D1) if (!env || !env[b]) missing.d1.push(b);
  for (const b of REQUIRED_BINDINGS) if (!env || !env[b]) missing.bindings.push(b);
  for (const s of REQUIRED_SECRETS) if (!present(env && env[s])) missing.secrets.push(s);
  for (const v of REQUIRED_VARS) {
    const val = (env && env[v] ? env[v].toString() : '').trim();
    if (!val || /YOUR-FRONTEND-DOMAIN|example\.com/i.test(val)) missing.vars.push(v);
  }
  for (const s of FEATURE_SECRETS) if (!present(env && env[s])) featureWarnings.push(s);

  const ok = missing.d1.length === 0 && missing.bindings.length === 0 &&
             missing.secrets.length === 0 && missing.vars.length === 0;
  return { ok, missing, featureWarnings };
}

// Readiness probe: verifies the config AND that D1 + KV actually respond. Cheap
// (one SELECT 1, one KV get). Never throws. Used by the GET health endpoint.
export async function healthCheck(env) {
  const cfg = checkConfig(env);
  const checks = {};

  // D1: a trivial round-trip against the core DB.
  try {
    if (env && env.DB_CORE) {
      await env.DB_CORE.prepare('SELECT 1 AS ok').first();
      checks.d1_core = 'ok';
    } else {
      checks.d1_core = 'missing-binding';
    }
  } catch (e) {
    checks.d1_core = 'error: ' + (e && e.message ? e.message.slice(0, 120) : 'unknown');
  }

  // KV: a read of a key that need not exist (a missing key is still a healthy KV).
  try {
    if (env && env.KV_SESSIONS) {
      await env.KV_SESSIONS.get('healthcheck:probe');
      checks.kv_sessions = 'ok';
    } else {
      checks.kv_sessions = 'missing-binding';
    }
  } catch (e) {
    checks.kv_sessions = 'error: ' + (e && e.message ? e.message.slice(0, 120) : 'unknown');
  }

  const dependenciesOk = checks.d1_core === 'ok' && checks.kv_sessions === 'ok';
  const status = cfg.ok && dependenciesOk ? 'ok' : 'degraded';
  return {
    status,
    configOk: cfg.ok,
    // Only the NAMES of missing items — never any value.
    missing: cfg.missing,
    featureWarnings: cfg.featureWarnings,
    checks,
  };
}
