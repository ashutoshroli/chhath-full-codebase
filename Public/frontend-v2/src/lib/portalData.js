// Cached, quota-friendly portal-data loader for the v2 public portal.
//
// WHY THIS EXISTS (the version-keyed edge cache matters)
// The portal is served through Cloudflare, whose Cache Rules serve the big
// version-keyed payloads (?action=portalData&v=<version>) straight from the EDGE
// CACHE without invoking the Worker. On a plain refresh only a tiny always-fresh
// version ping (?action=dataVersion) actually reaches the Worker. When the mgmt
// data changes the version bumps, the URL changes, and the fresh payload is
// fetched exactly once (then cached again). This is what keeps the daily
// Workers-request quota from being burned during a festival traffic spike.
//
// Two independent safety nets sit under that: an in-session cache (reuse the
// payload we already have when the version is unchanged) and a localStorage
// last-known-good snapshot (so a total backend outage / exhausted free tier
// still renders a fully working portal from this browser's saved copy). The
// loader NEVER dead-ends and NEVER calls a D1 endpoint — only ?action=dataVersion
// and ?action=portalData.
//
// The PURE helpers below are exported separately from the fetch orchestration so
// the URL/cache/guard logic is unit-testable with plain `node --test` — no
// network, no globals.

// ---- PURE helpers (no I/O) -------------------------------------------------

// Build the versioned portalData URL. config.js's apiBase has NO trailing slash,
// so we always attach the query with '?action=portalData'. The '&v=<version>'
// segment is added ONLY when `version` is a non-empty string (mirrors the old
// site's `vq` logic); a blank/absent version yields the un-versioned URL, which
// the Worker still serves via its ETag path.
//
// Exact shapes produced (apiBase = 'https://host'):
//   version present -> 'https://host?action=portalData&v=<encoded>'
//   version blank    -> 'https://host?action=portalData'
export function buildPortalUrl(apiBase, version) {
  const base = apiBase || '';
  const hasVersion = typeof version === 'string' && version !== '';
  const vq = hasVersion ? ('&v=' + encodeURIComponent(version)) : '';
  return base + '?action=portalData' + vq;
}

// The tiny always-fresh version ping. Same base-plus-query shape as above.
export function buildDataVersionUrl(apiBase) {
  return (apiBase || '') + '?action=dataVersion';
}

// Reuse the session-cached payload ONLY when the freshly-resolved version is a
// non-empty string AND identical to the one we already loaded this session.
// WHY: the version-keyed URL is immutable — an unchanged version means the exact
// same payload, so re-fetching would waste a request for byte-identical data. A
// blank/absent version must NOT reuse (we can't prove the data is unchanged).
export function shouldReuseCache(prevVersion, newVersion) {
  return typeof newVersion === 'string' && newVersion !== '' && newVersion === prevVersion;
}

// Guard against a 200 that is actually a soft failure object ({status:false}) or
// an empty shell with no real data: a genuine payload is a non-null object with
// status !== false that carries at least one of the known data arrays. Callers
// prefer this browser's saved copy over rendering an empty portal.
export function looksRealPayload(res) {
  return !!(res && typeof res === 'object' && res.status !== false &&
    (Array.isArray(res.collections) || Array.isArray(res.committee) ||
      Array.isArray(res.loans) || Array.isArray(res.expenses) || Array.isArray(res.users)));
}

// Return a shallow copy with every array coalesced to [] — a snapshot (this
// browser's localStorage OR an older deploy) can predate a key, and a partial
// deployment omits others. Without this, a `.forEach` on undefined would blank
// the whole portal on the one path whose entire purpose is to keep it up.
export function coalescePortalData(res) {
  const r = res || {};
  return {
    ...r,
    collections: r.collections || [],
    loans: r.loans || [],
    committee: r.committee || [],
    expenses: r.expenses || [],
    generatedFiles: r.generatedFiles || [],
    loanConsents: r.loanConsents || [],
  };
}

// Resolve the dataVersion JSON ({v: <n>}) to a string version, or '' when the
// call failed / returned nothing usable. Mirrors the old site's version resolve.
export function parseVersion(vr) {
  return vr && vr.v != null ? vr.v.toString() : '';
}

// ---- localStorage last-known-good snapshot ---------------------------------
//
// v2-specific key so it never collides with the old site's
// 'cpm_public_portalData_v1' while both portals may be visited by the same
// browser. All access is wrapped in typeof/try-catch guards so this module still
// LOADS (and the pure helpers stay testable) under plain `node --test`, where
// `window`/`localStorage` do not exist.
export const LOCAL_SNAPSHOT_KEY = 'cpm_public_v2_portalData_v1';

function getLocalStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) { /* access to localStorage can itself throw (privacy mode) */ }
  return null;
}

// Persist the freshly-loaded payload. Best-effort: private mode / quota-full
// localStorage just no-ops (the site still worked this load). A ~4MB ceiling
// (localStorage is ~5MB/origin; leave headroom) means a very large payload can't
// throw and can't blow the budget — if it doesn't fit we keep the previous copy.
export function saveLocalSnapshot(res) {
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    const payload = JSON.stringify({ savedAt: Date.now(), data: res });
    if (payload.length > 4000000) return;
    ls.setItem(LOCAL_SNAPSHOT_KEY, payload);
  } catch (e) { /* private mode or quota — non-critical, ignore */ }
}

// Read the last-known-good copy. Returns { data, savedAt } or null.
export function loadLocalSnapshot() {
  const ls = getLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(LOCAL_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return null;
    return { data: parsed.data, savedAt: parsed.savedAt || 0 };
  } catch (e) { return null; }
}

// ---- Fetch orchestration ---------------------------------------------------
//
// Async, and the only part that touches fetch/localStorage. Kept as a separate
// exported function so the pure helpers above can be tested without a network.
//
//   fetchImpl    injectable fetch (defaults to global fetch) — makes the orchestration
//                testable and lets Astro pass the browser's fetch explicitly.
//   sessionCache a plain object { version, data } persisted for the tab/session by
//                the caller (the Home island). When the resolved version is
//                unchanged we reuse sessionCache.data instead of re-fetching.
//
// Returns { data, fromCache, savedAt } where:
//   fromCache:false  fresh live data (also written to the session + local snapshot)
//   fromCache:true   this browser's saved snapshot (network/backend unreachable);
//                    `savedAt` is the snapshot timestamp for the stale-data notice.
// Throws only on a COLD failure: everything failed AND there is no snapshot — the
// caller renders the friendly retry card.
export async function loadPortalData({ apiBase, fetchImpl, sessionCache } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const cache = sessionCache || {};

  // 1) Always-fresh version ping FIRST. Any failure resolves to '' (un-versioned).
  let version = '';
  try {
    const vr = await doFetch(buildDataVersionUrl(apiBase)).then((r) => (r && r.ok ? r.json() : null));
    version = parseVersion(vr);
  } catch (e) {
    version = '';
  }

  // 2) Reuse the in-session payload when the version is unchanged (immutable URL).
  if (shouldReuseCache(cache.version, version) && cache.data) {
    return { data: cache.data, fromCache: false, savedAt: 0 };
  }

  // 3) Fetch the (edge-cached) versioned payload; validate it looks real.
  try {
    const res = await doFetch(buildPortalUrl(apiBase, version)).then((r) => {
      if (!r || !r.ok) throw new Error('portalData HTTP ' + (r && r.status));
      return r.json();
    });
    if (!looksRealPayload(res)) throw new Error('portalData returned no usable data');

    const data = coalescePortalData(res);
    // Remember for this session (keyed by version) and persist as last-known-good.
    cache.version = version;
    cache.data = data;
    saveLocalSnapshot(res);
    return { data, fromCache: false, savedAt: 0 };
  } catch (err) {
    // 4) NEVER dead-end. Fall back to this browser's saved copy so the portal
    // works offline / through a total backend outage / after the free tier is
    // exhausted. Only a brand-new visitor's first-ever failed load has no
    // snapshot — surface a cold failure the caller renders as the retry card.
    const cached = loadLocalSnapshot();
    if (cached) {
      return { data: coalescePortalData(cached.data), fromCache: true, savedAt: cached.savedAt };
    }
    throw err;
  }
}
