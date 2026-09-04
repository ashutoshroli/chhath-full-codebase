// Simple in-memory cache so switching tabs back and forth doesn't refetch every
// time. Resets on full page reload (fine — the backend also caches, keyed on the
// data version).
//
// audit M-30 — this Map had NO BOUND and entries were only ever evicted when the
// same key was read again after expiry. Keys embed the year and other parameters
// ('home:2026', 'loans:2025', 'profile:USER0123', ...), so a session that browses
// years and member profiles accumulates entries that are never read again and
// therefore never dropped. Each one holds a whole view payload — for the Home view
// that is up to 1000 collection rows (see P-2) — on a phone, in a tab that stays
// open all day during a collection drive.
//
// Two changes: expired entries are swept on write, and the store is capped with
// oldest-first eviction so the worst case is bounded rather than "however long the
// tab has been open".
const store = new Map();
const TTL_MS = 5 * 60 * 1000;
// Generous: the portal has ~25 views and a handful of years, so a legitimate
// session stays well under this. It exists to bound pathological cases, not to
// evict during normal use.
const MAX_ENTRIES = 120;

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.time > TTL_MS) { store.delete(key); return undefined; }
  return entry.value;
}

export function setCached(key, value) {
  // Sweep what has already expired. Cheap: this runs once per view load, not per
  // render, and the map is small by construction.
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.time > TTL_MS) store.delete(k);
  }
  // Map preserves insertion order, so the first key is the oldest. Re-setting an
  // existing key does not move it, which is the behaviour we want: a key that keeps
  // being refreshed should not outrank one that was cached recently for the first
  // time.
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  store.set(key, { value, time: now });
}

// Test-only visibility into the bound. Not used by the app.
export function _cacheSize() { return store.size; }

export function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
