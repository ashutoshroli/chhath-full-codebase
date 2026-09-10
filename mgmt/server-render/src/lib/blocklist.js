// Secret / PII path blocklist — mirrors the Worker's aiFix.isBlockedPath. A file
// whose path matches is NEVER sent to Claude or committed. Pure (no config/env),
// so it is safe to import in isolation (e.g. from tests).
const BLOCKED_EXACT = new Set(['wrangler.toml']);
const BLOCKED_NAME_SUBSTRINGS = ['secret', 'key', 'token', 'password', 'credential', '.pem'];

export function isBlockedPath(path) {
  const p = (path || '').toString().trim();
  if (!p) return true;
  const lower = p.toLowerCase();
  const base = lower.split('/').pop() || lower;
  if (/(^|\/)\.env(\.|$)/.test(lower)) return true;
  if (base === 'wrangler.toml' || BLOCKED_EXACT.has(base)) return true;
  if (lower.endsWith('.secret')) return true;
  if (/(^|\/)mgmt\/db\/migration\/.*\.sql$/.test(lower)) return true;
  if (/(^|\/)mgmt\/db\/schema\/.*\.sql$/.test(lower)) return true;
  if (BLOCKED_NAME_SUBSTRINGS.some(s => base.includes(s))) return true;
  return false;
}
