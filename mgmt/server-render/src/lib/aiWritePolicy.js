// ============ WHAT THE AI IS ALLOWED TO WRITE (Render side) ============
//
// audit Render/offload #7. See `mgmt/backend/src/aiWritePolicy.js` for the full reasoning.
// The short version: what the AI could touch was a DENYLIST, which fails open — and the
// things it did not list are the dangerous ones. `.github/workflows/*.yml` is code that runs
// in CI with the repository's secrets; `package.json` is dependency substitution and a
// `postinstall` hook. Meanwhile the model's input is error text, source and CI LOGS, all of
// which a third party can influence, and a model cannot tell an instruction from data.
//
// This service is where the diff is actually applied and committed, so it is where both
// rules are enforced: the allowlist, and "the diff may only touch files the model was
// shown".
//
// KEEP IN SYNC with `mgmt/backend/src/aiWritePolicy.js`; the Worker's
// `test/ai-write-policy.test.mjs` reads both files and fails on drift.

// ---- 8< ---- POLICY (kept byte-identical in both copies) ---- 8< ----
// A writable path must start with one of these. Every entry is a source tree: the AI fixes
// code, and everything that decides how code is BUILT or DEPLOYED is out of reach.
export const WRITABLE_ROOTS = [
  'mgmt/backend/src/',
  'mgmt/backend/test/',
  'mgmt/server-render/src/',
  'mgmt/server-render/test/',
  'mgmt/frontend/src/',
  'mgmt/frontend-svelte/src/',
  'Public/backend/src/',
  'Public/backend/test/',
  'Public/frontend-v4/src/',
  'Public/frontend-v5/src/',
  'Public/frontend-v6/src/',
];

// Source extensions only. `.json`, `.toml`, `.yml`, `.yaml` and `.lock` are absent on
// purpose — those are manifests and configuration, not code the AI is fixing.
export const WRITABLE_EXTENSIONS = [
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.svelte', '.css', '.scss', '.html', '.md',
];

// Refused even if a root above is ever widened to include them. Belt and braces: the
// allowlist already excludes all of these, and stating them makes the INTENT testable —
// if someone adds `mgmt/` as a writable root, these must still be unreachable.
export const NEVER_WRITABLE = [
  /(^|\/)\.github\//,                 // workflows run in CI with the repo's secrets
  /(^|\/)package(-lock)?\.json$/,     // dependency substitution / postinstall
  /(^|\/)(yarn\.lock|pnpm-lock\.yaml)$/,
  /(^|\/)wrangler\.toml$/,
  /(^|\/)vercel\.json$/,
  /(^|\/)render\.yaml$/,
  /(^|\/)Dockerfile$/i,
  /(^|\/)(vite|svelte|tailwind|postcss)\.config\.[cm]?[jt]s$/,
  /(^|\/)tsconfig(\..+)?\.json$/,
  /(^|\/)\.npmrc$/,
];

/** Normalises a diff path and refuses anything that could escape the tree. */
export function normalizeWritePath(raw) {
  const p = (raw === undefined || raw === null ? '' : raw.toString()).trim();
  if (!p) return null;
  if (p.includes('\0') || p.includes('\\')) return null;
  // A diff can carry `a/` and `b/` prefixes; callers usually strip them, but not always.
  const cleaned = p.replace(/^[ab]\//, '');
  if (cleaned.startsWith('/')) return null;              // absolute
  if (cleaned.split('/').some((seg) => seg === '..' || seg === '.')) return null; // traversal
  return cleaned;
}

/**
 * May the AI write this path? Returns `{ ok: true, path }` or `{ ok: false, error }`.
 * `isBlockedName` is the existing denylist, passed in so both deployments keep using the
 * one they already have rather than growing a second copy of it.
 */
export function checkWritablePath(raw, isBlockedName) {
  const path = normalizeWritePath(raw);
  if (!path) return { ok: false, error: `refusing an unsafe path: ${raw}` };

  if (NEVER_WRITABLE.some((re) => re.test(path))) {
    return { ok: false, error: `refusing to modify build/deploy configuration: ${path}` };
  }
  if (!WRITABLE_ROOTS.some((root) => path.startsWith(root))) {
    return { ok: false, error: `${path} is outside every writable source root` };
  }
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
  if (!WRITABLE_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `${path} does not have a writable source extension` };
  }
  // Second line: the existing secret/PII denylist still applies inside an allowed root.
  if (typeof isBlockedName === 'function' && isBlockedName(path)) {
    return { ok: false, error: `refusing to modify a protected path: ${path}` };
  }
  return { ok: true, path };
}

/**
 * The prompt-injection containment. A diff may only touch files the model was SHOWN.
 *
 * The model's input includes error messages, source and CI logs — text a third party can
 * influence. This rule does not require having correctly enumerated every dangerous path:
 * whatever a log talks the model into editing, that file was not in the context set, so the
 * diff is refused as a whole.
 *
 * Refusing the WHOLE diff rather than dropping the extra file is deliberate: a diff that
 * touched something it was not asked to is not a diff to partially trust.
 */
export function checkDiffWithinContext(diffPaths, contextPaths) {
  const allowed = new Set(
    (contextPaths || []).map((p) => normalizeWritePath(typeof p === 'string' ? p : (p && p.path))).filter(Boolean)
  );
  if (!allowed.size) return { ok: false, error: 'no context files were recorded for this fix' };
  for (const raw of diffPaths || []) {
    const p = normalizeWritePath(raw);
    if (!p) return { ok: false, error: `refusing an unsafe path: ${raw}` };
    if (!allowed.has(p)) {
      return { ok: false, error: `${p} was not among the files given to the model — refusing the diff` };
    }
  }
  return { ok: true };
}

// A branch name is interpolated into a git ref path (`refs/heads/<branch>`), so an
// unvalidated id could climb out of it. `fix/error-<id>` with a constrained id cannot.
export const BRANCH_PREFIXES = ['fix/error-', 'fix/ci-'];

export function checkBranchName(branch) {
  const b = (branch || '').toString();
  if (!BRANCH_PREFIXES.some((p) => b.startsWith(p))) {
    return { ok: false, error: `refusing a branch outside the fix/ namespace: ${b}` };
  }
  if (!/^[A-Za-z0-9/_.-]+$/.test(b) || b.includes('..') || b.endsWith('.lock') || b.endsWith('/')) {
    return { ok: false, error: `refusing an unsafe branch name: ${b}` };
  }
  return { ok: true };
}
// ---- 8< ---- END POLICY ---- 8< ----
