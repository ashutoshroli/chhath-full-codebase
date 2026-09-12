

export function buildPortalUrl(apiBase, version) {
  const base = apiBase || '';
  const hasVersion = typeof version === 'string' && version !== '';
  const vq = hasVersion ? ('&v=' + encodeURIComponent(version)) : '';
  return base + '?action=portalData' + vq;
}

export function buildDataVersionUrl(apiBase) {
  return (apiBase || '') + '?action=dataVersion';
}

export function shouldReuseCache(prevVersion, newVersion) {
  return typeof newVersion === 'string' && newVersion !== '' && newVersion === prevVersion;
}

export function looksRealPayload(res) {
  return !!(res && typeof res === 'object' && res.status !== false &&
    (Array.isArray(res.collections) || Array.isArray(res.committee) ||
      Array.isArray(res.loans) || Array.isArray(res.expenses) || Array.isArray(res.users)));
}

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

export function parseVersion(vr) {
  return vr && vr.v != null ? vr.v.toString() : '';
}

export const LOCAL_SNAPSHOT_KEY = 'cpm_public_v2_portalData_v1';

function getLocalStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) {  }
  return null;
}

export function saveLocalSnapshot(res) {
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    const payload = JSON.stringify({ savedAt: Date.now(), data: res });
    if (payload.length > 4000000) return;
    ls.setItem(LOCAL_SNAPSHOT_KEY, payload);
  } catch (e) {  }
}

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

export async function loadPortalData({ apiBase, fetchImpl, sessionCache } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const cache = sessionCache || {};

  let version = '';
  try {
    const vr = await doFetch(buildDataVersionUrl(apiBase)).then((r) => (r && r.ok ? r.json() : null));
    version = parseVersion(vr);
  } catch (e) {
    version = '';
  }

  if (shouldReuseCache(cache.version, version) && cache.data) {
    return { data: cache.data, fromCache: false, savedAt: 0 };
  }

  try {
    const res = await doFetch(buildPortalUrl(apiBase, version)).then((r) => {
      if (!r || !r.ok) throw new Error('portalData HTTP ' + (r && r.status));
      return r.json();
    });
    if (!looksRealPayload(res)) throw new Error('portalData returned no usable data');

    const data = coalescePortalData(res);
    cache.version = version;
    cache.data = data;
    saveLocalSnapshot(res);
    return { data, fromCache: false, savedAt: 0 };
  } catch (err) {
    const cached = loadLocalSnapshot();
    if (cached) {
      return { data: coalescePortalData(cached.data), fromCache: true, savedAt: cached.savedAt };
    }
    throw err;
  }
}
