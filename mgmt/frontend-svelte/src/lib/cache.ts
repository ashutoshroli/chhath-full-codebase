// In-memory view cache with a TTL, size cap, and a version-keyed localStorage
// mirror, keyed to the ACCOUNT it was filled for.
//
// audit P0-08 (the reason this file is no longer a verbatim port of
// mgmt/frontend/src/cache.js):
//
//   * The mirror was hydrated into memory at MODULE LOAD, before anything knew
//     who was signed in, and its keys were generic ('users', 'loginusers',
//     'home:2026', …). clearSession() removed only the token/user keys, so the
//     cached rows survived a sign-out. The next account on that browser could be
//     served the previous account's Users / Login Management / finance data — for
//     up to the 5-minute TTL, and for as long as the backend data version still
//     matched.
//   * Hydration is now deferred until setCacheIdentity() confirms the stored
//     mirror belongs to the account that is signing in. A different account (or a
//     changed role) purges instead of hydrating.
//   * The most sensitive views are never written to localStorage at all — see
//     MEMORY_ONLY_PREFIXES. They stay in memory, which dies with the tab.

interface Entry {
  value: unknown;
  time: number;
}
interface Mirror {
  version: string | null;
  identity: string | null;
  entries: Record<string, Entry>;
}

const store = new Map<string, Entry>();
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 120;

const LS_KEY = 'cpm_mgmt_viewcache_v1';
const LS_VERSION_KEY = 'cpm_mgmt_viewcache_version';
const LS_MAX_ENTRY_CHARS = 1500000;
const LS_MAX_TOTAL_CHARS = 3500000;

// Views whose rows are personal data or security metadata. These are cached in
// memory (so tab-local navigation stays fast) but NEVER persisted to disk.
const MEMORY_ONLY_PREFIXES = [
  'users',
  'loginusers',
  'committee',
  'consent',
  'email',
  'official',
  'audit',
  'loginAttempts',
  'sessions',
  'errorLog',
  'aiProviders',
  'whatsapp'
];

function isMemoryOnly(key: string): boolean {
  const k = key.toLowerCase();
  return MEMORY_ONLY_PREFIXES.some((p) => k.startsWith(p.toLowerCase()));
}

let currentVersion: string | null = null;
let currentIdentity: string | null = null;

function lsGetMirror(): Mirror | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) return null;
    return parsed as Mirror;
  } catch {
    return null;
  }
}

function lsWriteMirror(mirror: Mirror): void {
  try {
    const str = JSON.stringify(mirror);
    if (str.length > LS_MAX_TOTAL_CHARS) {
      const keys = Object.keys(mirror.entries).sort(
        (a, b) => (mirror.entries[a].time || 0) - (mirror.entries[b].time || 0)
      );
      while (keys.length && JSON.stringify(mirror).length > LS_MAX_TOTAL_CHARS) {
        const k = keys.shift();
        if (k) delete mirror.entries[k];
      }
      if (JSON.stringify(mirror).length > LS_MAX_TOTAL_CHARS) return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(mirror));
  } catch {
    /* ignore */
  }
}

/**
 * Drop everything: memory and the persisted mirror.
 *
 * Called on sign-out, on an authentication failure, and whenever the account or
 * role behind the cache changes. It is deliberately synchronous so no render can
 * observe another account's rows.
 */
export function purgeCache(): void {
  store.clear();
  currentVersion = null;
  currentIdentity = null;
  try {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_VERSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Bind the cache to an account. Pass a stable identity (name + role); pass null
 * to leave the cache empty (nobody signed in).
 *
 * Returns true when the persisted mirror belonged to this identity and was
 * hydrated, false when it was purged. Nothing is readable before this is called
 * for the first time — that is the point (audit P0-08).
 */
export function setCacheIdentity(identity: string | null): boolean {
  const next = identity == null || identity === '' ? null : identity.toString();
  if (next == null) {
    purgeCache();
    return false;
  }
  if (currentIdentity === next && store.size > 0) return true;

  const mirror = lsGetMirror();
  const sameAccount = !!mirror && mirror.identity === next;
  if (!sameAccount) {
    purgeCache();
    currentIdentity = next;
    return false;
  }

  // Same account: adopt the mirror's version and hydrate the entries still inside
  // the TTL. Anything sensitive was never written, so nothing sensitive is here.
  currentIdentity = next;
  currentVersion = mirror!.version != null ? mirror!.version.toString() : null;
  const now = Date.now();
  store.clear();
  for (const key of Object.keys(mirror!.entries || {})) {
    const e = mirror!.entries[key];
    if (e && !isMemoryOnly(key) && now - (e.time || 0) <= TTL_MS) {
      store.set(key, { value: e.value, time: e.time || now });
    }
  }
  return true;
}

/** Test/diagnostic helper: which account the cache is currently bound to. */
export function _cacheIdentity(): string | null {
  return currentIdentity;
}

export function setDataVersion(version: string | number | null): boolean {
  const v = version == null ? null : version.toString();
  const wasHydratedFor = currentVersion;
  currentVersion = v;

  if (v != null && wasHydratedFor != null && wasHydratedFor === v) {
    try {
      localStorage.setItem(LS_VERSION_KEY, v);
    } catch {
      /* ignore */
    }
    return true;
  }

  store.clear();
  try {
    localStorage.removeItem(LS_KEY);
    if (v != null) localStorage.setItem(LS_VERSION_KEY, v);
  } catch {
    /* ignore */
  }
  return false;
}

export function hasFresh(key: string): boolean {
  const entry = store.get(key);
  return !!entry && Date.now() - entry.time <= TTL_MS;
}

export function getCached<T = unknown>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.time > TTL_MS) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached(key: string, value: unknown): void {
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

function mirrorPut(key: string, value: unknown, time: number): void {
  if (currentVersion == null) return;
  // audit P0-08: no identity means nobody has been authenticated yet, and the
  // sensitive views never reach the disk at all.
  if (currentIdentity == null || isMemoryOnly(key)) return;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > LS_MAX_ENTRY_CHARS) return;
    const mirror: Mirror = lsGetMirror() || { version: currentVersion, identity: currentIdentity, entries: {} };
    if (mirror.version !== currentVersion || mirror.identity !== currentIdentity) {
      mirror.version = currentVersion;
      mirror.identity = currentIdentity;
      mirror.entries = {};
    }
    mirror.entries[key] = { value, time };
    lsWriteMirror(mirror);
    localStorage.setItem(LS_VERSION_KEY, currentVersion);
  } catch {
    /* ignore */
  }
}

export function _cacheSize(): number {
  return store.size;
}

export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  try {
    const mirror = lsGetMirror();
    if (mirror && mirror.entries) {
      let changed = false;
      for (const key of Object.keys(mirror.entries)) {
        if (key.startsWith(prefix)) {
          delete mirror.entries[key];
          changed = true;
        }
      }
      if (changed) lsWriteMirror(mirror);
    }
  } catch {
    /* ignore */
  }
}
