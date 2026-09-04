// D1 stores "boolean" flag columns (active, otp_verified, Priority, reported,
// Announced, Is Resell, Active, etc.) with TEXT affinity. SQLite's TEXT
// affinity silently converts a bound number (1/0) into the string '1'/'0' at
// storage time, so a strict-equality check against the JS boolean `true` or
// the number `1` alone will never match what actually comes back from the
// database. This single helper is the source of truth for "is this flag on?"
// across the whole frontend — use it instead of ad-hoc === chains.
//
// audit M-31 — THIS MUST STAY BEHAVIOURALLY IDENTICAL TO
// mgmt/backend/src/flags.js. It was not. The old frontend version was:
//
//     return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
//
// which differs from the backend in two ways that both show up in real data:
//
//   * NO TRIM. The original Google Sheet migration wrote values with stray
//     whitespace, so ' 1 ' and 'True ' are present in live columns. The backend
//     reads those as ON; the frontend read them as OFF.
//   * DOES NOT ACCEPT 'yes', which the backend does.
//
// The consequence is the "Active but never shown" class of bug in reverse: the
// backend serves a popup/template/announcement as live while the admin list
// renders its badge as inactive, or an operator toggles a flag that the UI then
// claims did not change. There is no error and nothing in the log — the two halves
// of the app simply disagree about the same byte.
//
// The two files cannot import from each other (separate build targets, separate
// deployments), so this is a comment-enforced invariant like the other
// deliberately-duplicated helpers. A test asserts the two agree on every form
// either one has ever been given.
export function isTruthyFlag(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  const s = v.toString().trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
