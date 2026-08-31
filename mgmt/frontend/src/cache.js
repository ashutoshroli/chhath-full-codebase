// Simple in-memory cache so switching tabs back and forth doesn't refetch from Apps Script every time.
// Resets on full page reload (fine — backend also caches for 15 min).
const store = new Map();
const TTL_MS = 5 * 60 * 1000;

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.time > TTL_MS) { store.delete(key); return undefined; }
  return entry.value;
}

export function setCached(key, value) {
  store.set(key, { value, time: Date.now() });
}

export function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
