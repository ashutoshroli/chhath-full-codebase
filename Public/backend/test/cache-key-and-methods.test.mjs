// ============ PUBLIC WORKER — CACHE KEY AND METHOD CONTRACT ============
//
// audit PUB-BE-01 / PUB-BE-02. The first tests this Worker has ever had. They
// import `src/index.js` directly and stub the three platform pieces it touches —
// D1, KV and the Cache API — so there is nothing to install and no lockfile
// needed (the full Miniflare/workerd harness is a later change).
//
// What is pinned here is the part of this Worker that protects a SHARED, metered
// resource: the D1 daily row quota, which the management API draws from the same
// databases. Every assertion below is about one question — can an anonymous caller
// make this Worker rebuild the whole portal payload at will?
//
//   * It could, by varying ANY query parameter: the edge cache was keyed on the
//     client's full request URL, so `&utm_source=1`, `&utm_source=2`, … were all
//     distinct keys for one payload, each missing and each running nine table
//     scans across four databases.
//   * It could, by using a different HTTP verb: read actions had no method check,
//     and a non-GET request cannot be stored in the Cache API at all, so every
//     `POST ?action=portalData` was an uncached full build.
//
// Both are now closed, and a third bug went with them: a whole Response used to be
// cached, so the `Access-Control-Allow-Origin` of whoever caused the miss was
// replayed to callers from other origins.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const VERSION = '42';
const BASE = 'https://api.example/';
const CACHE_ORIGIN = 'https://public-cache.internal';

/** Every SQL statement prepared during the current test, for cost assertions. */
let prepared = [];

/** A D1 stub: records the SQL and answers from `rowsFor`. */
function d1(rowsFor = () => ({ results: [] })) {
  return {
    prepare(sql) {
      prepared.push(sql.replace(/\s+/g, ' ').trim());
      const stmt = {
        bind: () => stmt,
        all: async () => rowsFor(sql),
        first: async () => (rowsFor(sql).results || [])[0] || null,
        run: async () => ({ success: true }),
      };
      return stmt;
    },
  };
}

/** Reads of the big tables — i.e. evidence that a full payload build happened. */
const tableScans = () => prepared.filter((s) => /FROM (users|collections|expenses|loans|committee_members)\b/.test(s)).length;

function makeEnv() {
  const core = d1((sql) => {
    if (sql.includes('portal_settings') && sql.includes('public_data_version')) {
      return { results: [{ key: 'public_data_version', value: VERSION }] };
    }
    if (sql.includes('FROM portal_settings')) return { results: [{ key: 'public_data_version', value: VERSION }] };
    if (sql.includes('FROM users')) return { results: [{ id: 1, id_code: 'USER0001', name: 'A', mobile: '99', email: 'a@example.com' }] };
    return { results: [] };
  });
  return {
    DB_CORE: core,
    DB_COLLECTIONS: d1(),
    DB_LOANS_EXPENSES: d1(),
    DB_FILE_INDEX: d1(),
    DB_MISC: d1(),
    DB_LOGS: d1(),
    ALLOWED_ORIGINS: 'https://portal.example, https://other.example',
  };
}

/**
 * A Cache API stub that keys on the request URL, exactly like `caches.default` —
 * including its refusal to store a non-GET request, which is what made the
 * unmethod-checked read actions uncacheable.
 */
function installCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const entry = store.get(typeof req === 'string' ? req : req.url);
        return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
      },
      async put(req, res) {
        if (req.method && req.method !== 'GET') throw new Error('Cannot cache a non-GET request');
        store.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) });
      },
    },
  };
  return store;
}

let env;
let cacheStore;
const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };

/** One request through the Worker, with `waitUntil` work awaited. */
async function call(path, init = {}) {
  const res = await worker.fetch(new Request(BASE + path, init), env, ctx);
  await Promise.all(pending.splice(0));
  return res;
}

beforeEach(() => {
  prepared = [];
  env = makeEnv();
  cacheStore = installCache();
});

describe('a read action answers GET and nothing else (PUB-BE-02)', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    test(`${method} ?action=portalData is refused before any database work`, async () => {
      const res = await call(`?action=portalData`, { method });

      assert.equal(res.status, 405);
      // RFC 9110: a 405 must say what IS allowed.
      assert.equal(res.headers.get('Allow'), 'GET, OPTIONS');
      // The point of the fix: a rejected verb costs nothing. On the old code a
      // POST ran the whole nine-scan build AND could not be cached, so it was a
      // free way to spend the D1 quota shared with the management API.
      assert.equal(prepared.length, 0, `expected no D1 work, got: ${prepared.join(' | ')}`);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
    });
  }

  test('GET on a write action is refused with the right Allow header', async () => {
    for (const action of ['logError', 'savePushSubscription']) {
      const res = await call(`?action=${action}`);
      assert.equal(res.status, 405, action);
      assert.equal(res.headers.get('Allow'), 'POST, OPTIONS', action);
    }
  });

  test('the two write actions still work on POST', async () => {
    const logged = await call('?action=logError', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: '/', message: 'boom' }),
    });
    assert.equal(logged.status, 200);

    const sub = await call('?action=savePushSubscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } }),
    });
    assert.equal(sub.status, 200);
  });

  test('an unknown action is rejected before any handler or cache lookup', async () => {
    const res = await call('?action=nonsense');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, 'Invalid Request');
    assert.equal(prepared.length, 0);
  });

  test('a verb other than GET on the bare root is refused', async () => {
    const res = await call('', { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('Allow'), 'GET, OPTIONS');
  });

  test('the preflight advertises the methods the action actually accepts', async () => {
    const read = await call('?action=portalData', { method: 'OPTIONS', headers: { Origin: 'https://portal.example' } });
    // It used to promise 'GET, POST, OPTIONS' for every endpoint, including the
    // read-only ones that reject POST.
    assert.equal(read.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');

    const write = await call('?action=logError', { method: 'OPTIONS', headers: { Origin: 'https://portal.example' } });
    assert.equal(write.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    // Reusable, so a preflight is not sent before every single POST.
    assert.equal(write.headers.get('Access-Control-Max-Age'), '86400');
  });
});

describe('one canonical cache key per action and version (PUB-BE-01)', () => {
  test('junk query parameters cannot force a rebuild', async () => {
    const first = await call(`?action=portalData&v=${VERSION}`);
    assert.equal(first.status, 200);
    assert.ok(tableScans() > 0, 'the first request must build from D1');

    prepared = [];
    for (const junk of ['utm_source=fb', 'utm_source=x', 'fbclid=abc', 'nonce=1', 'nonce=2', 'nonce=3']) {
      const res = await call(`?action=portalData&v=${VERSION}&${junk}`);
      assert.equal(res.status, 200, junk);
    }

    // On the old key scheme these six requests were six cache misses and six full
    // builds. They are now six hits on one entry.
    assert.equal(tableScans(), 0, `expected no rebuilds, saw: ${prepared.join(' | ')}`);
    assert.deepEqual([...cacheStore.keys()], [`${CACHE_ORIGIN}/portalData?v=${VERSION}`]);
  });

  test('the fast path and the fallback path share one build', async () => {
    await call(`?action=portalData&v=${VERSION}`); // fast path: ?v= matches the live version
    prepared = [];

    const fallback = await call('?action=portalData'); // no ?v= at all
    assert.equal(fallback.status, 200);
    assert.equal(tableScans(), 0, 'the fallback path must reuse the build the fast path cached');
    assert.equal(cacheStore.size, 1);
  });

  test('only a version-specific URL is marked immutable', async () => {
    const fast = await call(`?action=portalData&v=${VERSION}`);
    assert.equal(fast.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');

    // A URL with no ?v= means "whatever is current", so a year-long immutable
    // cache there would freeze the portal for that visitor.
    const fallback = await call('?action=portalData');
    assert.equal(fallback.headers.get('Cache-Control'), 'public, max-age=30, stale-while-revalidate=86400');
  });

  test('each action gets its own key, and a version bump gets a new one', async () => {
    await call(`?action=portalData&v=${VERSION}`);
    await call(`?action=summary&v=${VERSION}`);
    await call(`?action=activePopups&v=${VERSION}`);

    const keys = [...cacheStore.keys()].sort();
    assert.equal(keys.length, 3, 'one key per action, and no key per caller');
    assert.ok(keys.includes(`${CACHE_ORIGIN}/portalData?v=${VERSION}`));
    assert.ok(keys.includes(`${CACHE_ORIGIN}/summary?v=${VERSION}`));

    // `activePopups` carries a time bucket alongside the version (audit PUB-BE-04):
    // its answer depends on the CLOCK, not only on the data version, so the key has
    // to be able to expire on time. It is still derived from nothing the caller
    // controls, which is what this suite is about.
    const popupKey = keys.find((k) => k.startsWith(`${CACHE_ORIGIN}/activePopups`));
    assert.match(popupKey, new RegExp(`^${CACHE_ORIGIN}/activePopups\\?v=${VERSION}\\.t\\d+$`));

    // Nothing can serve a body from a previous version: the version is IN every key.
    assert.ok(!keys.some((k) => !k.includes(`v=${VERSION}`)));
  });

  test('ETag revalidation still returns 304', async () => {
    const res = await call('?action=portalData');
    const etag = res.headers.get('ETag');
    assert.equal(etag, `W/"portalData-v${VERSION}"`);

    const revalidated = await call('?action=portalData', { headers: { 'If-None-Match': etag } });
    assert.equal(revalidated.status, 304);
  });
});

describe('a cached body carries no other caller‘s CORS grant (PUB-BE-01)', () => {
  test('the allowed origin is decided per request, not per cache entry', async () => {
    const miss = await call(`?action=portalData&v=${VERSION}`, { headers: { Origin: 'https://portal.example' } });
    assert.equal(miss.headers.get('Access-Control-Allow-Origin'), 'https://portal.example');

    // Same payload, different allowed origin: the cached copy must not decide this.
    const hit = await call(`?action=portalData&v=${VERSION}`, { headers: { Origin: 'https://other.example' } });
    assert.equal(hit.headers.get('Access-Control-Allow-Origin'), 'https://other.example');

    // An origin that is not on the list gets no grant at all, cache hit or not.
    const denied = await call(`?action=portalData&v=${VERSION}`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  });
});

describe('the endpoints that must keep working', () => {
  test('the health probe still answers 200 when every binding is present', async () => {
    const res = await call('?health=1');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.healthy, true);
  });

  test('dataVersion still returns the live version', async () => {
    const res = await call('?action=dataVersion');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).v, VERSION);
  });

  test('publicGetSeo still answers for the deploy-time build step', async () => {
    const res = await call('?action=publicGetSeo');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, true);
  });
});
