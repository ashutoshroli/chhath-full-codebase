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
  assert.ok(!shouldReuseCache('', ''));
  assert.ok(!shouldReuseCache('5', ''));
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
  assert.deepEqual(result.data.loans, []);
  assert.equal(sessionCache.version, '7');
  assert.ok(sessionCache.data);
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls.some((u) => u.indexOf('action=portalData&v=7') !== -1));
});

test('loadPortalData: unchanged non-empty version reuses sessionCache without a second portalData fetch', async () => {
  const fetchImpl = makeFetch({
    dataVersion: () => ok({ v: 7 }),
    portalData: () => { throw new Error('portalData should NOT be fetched on reuse'); },
  });
  const priorData = coalescePortalData(REAL_PAYLOAD);
  const sessionCache = { version: '7', data: priorData };

  const result = await loadPortalData({ apiBase: 'https://host', fetchImpl, sessionCache });

  assert.equal(result.fromCache, false);
  assert.equal(result.data, priorData);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].indexOf('action=dataVersion') !== -1);
});

test('loadPortalData: a payload failing looksReal with NO snapshot throws (cold failure)', async () => {
  const fetchImpl = makeFetch({
    dataVersion: () => ok({ v: 9 }),
    portalData: () => ok({ status: false }),
  });
  await assert.rejects(
    loadPortalData({ apiBase: 'https://host', fetchImpl, sessionCache: {} }),
    /no usable data/,
  );
});

test('loadPortalData: a dataVersion failure still resolves to the un-versioned portalData URL and succeeds', async () => {
  const fetchImpl = makeFetch({
    dataVersion: () => { throw new Error('dataVersion unreachable'); },
    portalData: (url) => {
      assert.equal(url.indexOf('&v='), -1, 'un-versioned URL must omit &v=');
      return ok(REAL_PAYLOAD);
    },
  });
  const sessionCache = {};
  const result = await loadPortalData({ apiBase: 'https://host', fetchImpl, sessionCache });

  assert.equal(result.fromCache, false);
  assert.deepEqual(result.data.collections, REAL_PAYLOAD.collections);
  assert.equal(sessionCache.version, '');
});
