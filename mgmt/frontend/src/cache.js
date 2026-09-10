// View-data cache for the mgmt SPA.
//
// TWO layers, both keyed by the same string keys the views already use
// ('home:2026', 'users', 'committee:All', ...):
//
//   1. In-memory Map (primary, fast) — switching tabs back and forth doesn't
//      refetch. 5-min TTL, 120-entry cap with oldest-first eviction (audit M-30).
//
//   2. localStorage MIRROR (survives a full page reload) — so a browser refresh
//      shows the last-known-good data INSTANTLY and, combined with the
//      data-version gate in App.jsx, lets the shell (users/committee/years) skip
//      a heavy re-fetch when nothing changed on the server. This is the mgmt
//      counterpart of the Public portal's ?v= edge caching.
//
// SAFETY: the localStorage mirror is scoped to a data-version. App.jsx fetches
// the current version once on load; setDataVersion() clears the mirror whenever
// the version has moved on (any write bumps it server-side), so stale data can
// never be shown. Everything localStorage-related is best-effort and wrapped —
// private mode / quota-full / disabled storage all degrade silently to the
// in-memory-only behaviour that shipped before.

const store = new Map();
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 120;

// localStorage keys. The mirror holds { version, entries: { key: {value, time} } }.
const LS_KEY = 'cpm_mgmt_viewcache_v1';
const LS_VERSION_KEY = 'cpm_mgmt_viewcache_version';
// Only mirror payloads that are safe to persist: skip very large ones so we
// never blow the ~5MB origin localStorage budget or throw. 1.5MB per entry and
// ~3.5MB total are conservative ceilings.
const LS_MAX_ENTRY_CHARS = 1500000;
const LS_MAX_TOTAL_CHARS = 3500000;

// The data-version the in-memory + mirror caches are currently valid for. Set
// from the localStorage mirror at module load (optimistic) and confirmed by
// App.jsx via setDataVersion() once the server version is fetched.
let currentVersion = null;

// OPTIMISTIC HYDRATION at module load: pull the mirror's entries into memory
// right away so the first render after a browser refresh is instant (no blank
// flash, no immediate network wait). This is safe because setDataVersion() runs
// moments later with the authoritative server version and CLEARS + refetches if
// the mirror turned out to be stale. Until then we show the user their own
// last-known-good data, which is strictly better than a spinner.
(function hydrateOnLoad() {
  try {
    const mirror = lsGetMirror();
    if (!mirror || !mirror.entries) return;
    currentVersion = mirror.version != null ? mirror.version.toString() : null;
    const now = Date.now();
    for (const key of Object.keys(mirror.entries)) {
      const e = mirror.entries[key];
      if (e && now - (e.time || 0) <= TTL_MS) {
        store.set(key, { value: e.value, time: e.time || now });
      }
    }
  } catch (e) { /* storage blocked — start empty, exactly as before */ }
})();

function lsGetMirror() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) return null;
    return parsed;
  } catch (e) { return null; }
}

function lsWriteMirror(mirror) {
  try {
    const str = JSON.stringify(mirror);
    if (str.length > LS_MAX_TOTAL_CHARS) {
      // Too big as a whole — drop the oldest entries until it fits (or give up).
      const keys = Object.keys(mirror.entries).sort(
        (a, b) => (mirror.entries[a].time || 0) - (mirror.entries[b].time || 0)
      );
      while (keys.length && JSON.stringify(mirror).length > LS_MAX_TOTAL_CHARS) {
        delete mirror.entries[keys.shift()];
      }
      if (JSON.stringify(mirror).length > LS_MAX_TOTAL_CHARS) return; // still too big — skip
    }
    localStorage.setItem(LS_KEY, JSON.stringify(mirror));
  } catch (e) { /* private mode / quota — non-critical */ }
}

// Called by App.jsx once the current server data-version is known. If it differs
// from what the mirror was saved under, the mirror is stale → clear it. If it
// matches (or the mirror was empty), hydrate the in-memory store from the mirror
// so the very first getCached() after a refresh is a hit.
// Returns true if the confirmed version MATCHES what was optimistically
// hydrated (so the caller knows the cached shell data is trustworthy and no
// refetch is needed); false if the mirror was stale and has been cleared (the
// caller should refetch).
export function setDataVersion(version) {
  const v = version == null ? null : version.toString();
  const wasHydratedFor = currentVersion;
  currentVersion = v;

  // Version confirmed and it matches what we hydrated from — cache is valid.
  if (v != null && wasHydratedFor != null && wasHydratedFor === v) {
    try { localStorage.setItem(LS_VERSION_KEY, v); } catch (e) { /* ignore */ }
    return true;
  }

  // Version unknown/changed → the optimistically-hydrated data is stale. Wipe
  // BOTH the in-memory store and the mirror so nothing stale is shown, and let
  // the caller refetch under the new version.
  store.clear();
  try {
    localStorage.removeItem(LS_KEY);
    if (v != null) localStorage.setItem(LS_VERSION_KEY, v);
  } catch (e) { /* storage blocked — in-memory cache still works */ }
  return false;
}

// True if a fresh (non-expired) entry for `key` exists in the in-memory store —
// used by App.jsx to decide whether the shell can skip a network fetch.
export function hasFresh(key) {
  const entry = store.get(key);
  return !!entry && Date.now() - entry.time <= TTL_MS;
}

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.time > TTL_MS) { store.delete(key); return undefined; }
  return entry.value;
}

export function setCached(key, value) {
  // Sweep expired entries (cheap: once per view load, small map).
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.time > TTL_MS) store.delete(k);
  }
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  store.set(key, { value, time: now });
  // Write through to the localStorage mirror (best-effort, size-guarded).
  mirrorPut(key, value, now);
}

function mirrorPut(key, value, time) {
  if (currentVersion == null) return; // don't persist until the version is known
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > LS_MAX_ENTRY_CHARS) return; // too big to mirror — skip
    const mirror = lsGetMirror() || { version: currentVersion, entries: {} };
    // If the mirror belongs to an older version, start fresh for this version.
    if (mirror.version !== currentVersion) { mirror.version = currentVersion; mirror.entries = {}; }
    mirror.entries[key] = { value, time };
    lsWriteMirror(mirror);
    localStorage.setItem(LS_VERSION_KEY, currentVersion);
  } catch (e) { /* non-critical */ }
}

// Test-only visibility into the bound. Not used by the app.
export function _cacheSize() { return store.size; }

export function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  // Also drop matching entries from the mirror so a refresh doesn't resurrect them.
  try {
    const mirror = lsGetMirror();
    if (mirror && mirror.entries) {
      let changed = false;
      for (const key of Object.keys(mirror.entries)) {
        if (key.startsWith(prefix)) { delete mirror.entries[key]; changed = true; }
      }
      if (changed) lsWriteMirror(mirror);
    }
  } catch (e) { /* non-critical */ }
}
