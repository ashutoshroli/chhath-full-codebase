// Unit tests for the framework-free portal-data cache helpers.
// Runs under plain `node --test` — imports ONLY src/lib/portalData.js (no Astro,
// no network). The pure helpers are the contract; the fetch orchestration is not
// exercised here (it needs a network / DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPortalUrl,
  buildDataVersionUrl,
  shouldReuseCache,
  looksRealPayload,
  coalescePortalData,
  parseVersion,
  loadPortalData,
  LOCAL_SNAPSHOT_KEY,
} from '../src/lib/portalData.js';

const API = 'https://chhath-public-worker.shaharpura.com';

test('buildPortalUrl adds &v= only when version is a non-empty string', () => {
  assert.equal(buildPortalUrl(API, '5'), API + '?action=portalData&v=5');
  assert.equal(buildPortalUrl(API, ''), API + '?action=portalData');
  assert.equal(buildPortalUrl(API, undefined), API + '?action=portalData');
  assert.equal(buildPortalUrl(API, null), API + '?action=portalData');
});

test('buildPortalUrl url-encodes the version', () => {
  assert.equal(buildPortalUrl(API, 'a b'), API + '?action=portalData&v=a%20b');
});

test('buildDataVersionUrl shape', () => {
  assert.equal(buildDataVersionUrl(API), API + '?action=dataVersion');
});

test('shouldReuseCache is true only on an unchanged non-empty version', () => {
  assert.ok(shouldReuseCache('5', '5'));
  assert.ok(!shouldReuseCache('5', '6'));
  assert.ok(!shouldReuseCache('', ''));      // blank never reuses
  assert.ok(!shouldReuseCache('5', ''));     // new blank never reuses
  assert.ok(!shouldReuseCache(undefined, '5'));
  assert.ok(!shouldReuseCache('5', undefined));
});

test('looksRealPayload accepts a payload with a data array, rejects soft failures', () => {
  assert.ok(looksRealPayload({ collections: [] }));
  assert.ok(looksRealPayload({ users: [{ ID: '1' }] }));
  assert.ok(looksRealPayload({ loans: [], expenses: [] }));
  assert.ok(!looksRealPayload({ status: false, collections: [] }));
  assert.ok(!looksRealPayload({}));
  assert.ok(!looksRealPayload(null));
  assert.ok(!looksRealPayload(undefined));
  assert.ok(!looksRealPayload('string'));
});

test('coalescePortalData fills every missing array with []', () => {
  const out = coalescePortalData({ collections: [{ x: 1 }] });
  assert.deepEqual(out.collections, [{ x: 1 }]);
  assert.deepEqual(out.loans, []);
  assert.deepEqual(out.committee, []);
  assert.deepEqual(out.expenses, []);
  assert.deepEqual(out.generatedFiles, []);
  assert.deepEqual(out.loanConsents, []);
});

test('coalescePortalData handles null/undefined input', () => {
  const out = coalescePortalData(null);
  assert.deepEqual(out.collections, []);
  assert.deepEqual(out.expenses, []);
});

test('coalescePortalData preserves non-array extra fields', () => {
  const out = coalescePortalData({ collections: [], generatedAt: 123 });
  assert.equal(out.generatedAt, 123);
});

test('parseVersion resolves {v:n} and null', () => {
  assert.equal(parseVersion({ v: 5 }), '5');
  assert.equal(parseVersion({ v: 0 }), '0');
  assert.equal(parseVersion({ v: 'abc' }), 'abc');
  assert.equal(parseVersion(null), '');
  assert.equal(parseVersion({}), '');
  assert.equal(parseVersion({ v: null }), '');
});

test('LOCAL_SNAPSHOT_KEY is the v2-specific key', () => {
  assert.equal(LOCAL_SNAPSHOT_KEY, 'cpm_public_v2_portalData_v1');
});

// ---- loadPortalData orchestration ------------------------------------------
// These lock down the async branch selection the pure helpers can't cover:
// fresh load, session reuse, cold failure, and the un-versioned fallback path.
//
// A fake fetchImpl routes by URL substring and returns objects shaped like the
// slice of the Response the loader actually uses: { ok, status, json() }. No DOM
// is needed — under node there is no localStorage, so saveLocalSnapshot /
// loadLocalSnapshot are guarded no-ops (snapshot behaviour is exercised via the
// injected sessionCache instead). All fixtures are plain strings/objects.

// Build a fetchImpl from a route map keyed by an action substring. Each handler
// returns the object the fake Response's json() resolves to (or throws to
// simulate a network/HTTP failure). Records every requested URL for assertions.
function makeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const key = url.indexOf('action=portalData') !== -1 ? 'portalData'
      : url.indexOf('action=dataVersion') !== -1 ? 'dataVersion'
      : 'other';
    const handler = routes[key];
    if (!handler) throw new Error('unexpected fetch: ' + url);
    return handler(url);
  };
  impl.calls = calls;
  return impl;
}

// A successful fake Response whose json() yields `body`.
function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

const REAL_PAYLOAD = { collections: [{ Year: '2025', Amount: '100' }], users: [{ ID: '1' }] };

test('loadPortalData: fresh load returns {fromCache:false} and populates sessionCache', async () => {
  const fetchImpl = makeFetch({
    dataVersion: () => ok({ v: 7 }),
    portalData: () => ok(REAL_PAYLOAD),
  });
  const sessionCache = {};
  const result = await loadPortalData({ apiBase: 'https://host', fetchImpl, sessionCache });

  assert.equal(result.fromCache, false);
  assert.equal(result.savedAt, 0);
  assert.deepEqual(result.data.collections, REAL_PAYLOAD.collections);
  assert.deepEqual(result.data.loans, []); // coalesced
  // sessionCache is keyed by the resolved version and holds the coalesced data.
  assert.equal(sessionCache.version, '7');
  assert.ok(sessionCache.data);
  // Exactly one dataVersion ping + one versioned portalData fetch.
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls.some((u) => u.indexOf('action=portalData&v=7') !== -1));
});

test('loadPortalData: unchanged non-empty version reuses sessionCache without a second portalData fetch', async () => {
  const fetchImpl = makeFetch({
    dataVersion: () => ok({ v: 7 }),
    portalData: () => { throw new Error('portalData should NOT be fetched on reuse'); },
  });
  // Pre-seed the session cache as though a prior load stored version '7'.
  const priorData = coalescePortalData(REAL_PAYLOAD);
  const sessionCache = { version: '7', data: priorData };

  const result = await loadPortalData({ apiBase: 'https://host', fetchImpl, sessionCache });

  assert.equal(result.fromCache, false);
  assert.equal(result.data, priorData); // same object reused
  // Only the dataVersion ping happened — no portalData fetch.
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].indexOf('action=dataVersion') !== -1);
});

test('loadPortalData: a payload failing looksReal with NO snapshot throws (cold failure)', async () => {
  const fetchImpl = makeFetch({
    dataVersion: () => ok({ v: 9 }),
    portalData: () => ok({ status: false }), // soft failure, not a real payload
  });
  // No localStorage under node => loadLocalSnapshot() returns null => cold throw.
  await assert.rejects(
    loadPortalData({ apiBase: 'https://host', fetchImpl, sessionCache: {} }),
    /no usable data/,
  );
});

test('loadPortalData: a dataVersion failure still resolves to the un-versioned portalData URL and succeeds', async () => {
  const fetchImpl = makeFetch({
    // dataVersion network failure -> version resolves to '' -> un-versioned URL.
    dataVersion: () => { throw new Error('dataVersion unreachable'); },
    portalData: (url) => {
      // Confirm the URL carries NO &v= segment when the version is blank.
      assert.equal(url.indexOf('&v='), -1, 'un-versioned URL must omit &v=');
      return ok(REAL_PAYLOAD);
    },
  });
  const sessionCache = {};
  const result = await loadPortalData({ apiBase: 'https://host', fetchImpl, sessionCache });

  assert.equal(result.fromCache, false);
  assert.deepEqual(result.data.collections, REAL_PAYLOAD.collections);
  assert.equal(sessionCache.version, ''); // blank version cached (won't reuse next time)
});
