// D1 stores "boolean" flag columns (active, otp_verified, Priority, reported,
// Announced, Is Resell, Active, etc.) with TEXT affinity. SQLite's TEXT
// affinity silently converts a bound number (1/0) into the string '1'/'0' at
// storage time, so a strict-equality check against the JS boolean `true` or
// the number `1` alone will never match what actually comes back from the
// database. This single helper is the source of truth for "is this flag on?"
// across the whole frontend — use it instead of ad-hoc === chains.
export function isTruthyFlag(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}
