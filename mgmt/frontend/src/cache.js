
const store = new Map();
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 120;

const LS_KEY = 'cpm_mgmt_viewcache_v1';
const LS_VERSION_KEY = 'cpm_mgmt_viewcache_version';
const LS_MAX_ENTRY_CHARS = 1500000;
const LS_MAX_TOTAL_CHARS = 3500000;

let currentVersion = null;

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
  } catch (e) {  }
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
      const keys = Object.keys(mirror.entries).sort(
        (a, b) => (mirror.entries[a].time || 0) - (mirror.entries[b].time || 0)
      );
      while (keys.length && JSON.stringify(mirror).length > LS_MAX_TOTAL_CHARS) {
        delete mirror.entries[keys.shift()];
      }
      if (JSON.stringify(mirror).length > LS_MAX_TOTAL_CHARS) return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(mirror));
  } catch (e) {  }
}

export function setDataVersion(version) {
  const v = version == null ? null : version.toString();
  const wasHydratedFor = currentVersion;
  currentVersion = v;

  if (v != null && wasHydratedFor != null && wasHydratedFor === v) {
    try { localStorage.setItem(LS_VERSION_KEY, v); } catch (e) {  }
    return true;
  }

  store.clear();
  try {
    localStorage.removeItem(LS_KEY);
    if (v != null) localStorage.setItem(LS_VERSION_KEY, v);
  } catch (e) {  }
  return false;
}

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
  mirrorPut(key, value, now);
}

function mirrorPut(key, value, time) {
  if (currentVersion == null) return;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > LS_MAX_ENTRY_CHARS) return;
    const mirror = lsGetMirror() || { version: currentVersion, entries: {} };
    if (mirror.version !== currentVersion) { mirror.version = currentVersion; mirror.entries = {}; }
    mirror.entries[key] = { value, time };
    lsWriteMirror(mirror);
    localStorage.setItem(LS_VERSION_KEY, currentVersion);
  } catch (e) {  }
}

export function _cacheSize() { return store.size; }

export function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  try {
    const mirror = lsGetMirror();
    if (mirror && mirror.entries) {
      let changed = false;
      for (const key of Object.keys(mirror.entries)) {
        if (key.startsWith(prefix)) { delete mirror.entries[key]; changed = true; }
      }
      if (changed) lsWriteMirror(mirror);
    }
  } catch (e) {  }
}
