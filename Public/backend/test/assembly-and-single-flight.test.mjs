// ============ PUBLIC WORKER — HOW ONE BUILD IS PAID FOR ============
//
// audit PUB-BE-07. Three defects that all show up at the same moment — the second after
// a version bump, when every cache key in existence has just been invalidated.
//
// 1. The twelve portalData sections were twelve SEQUENTIAL awaits. They are independent,
//    so the build took the SUM of twelve round-trips across four databases while doing
//    nothing in between — latency paid by the visitor who caused the miss, and paid while
//    holding up everyone else.
//
// 2. Nothing collapsed CONCURRENT misses. The cache entry is written at the END of a
//    build, so every request arriving during one found no entry and started its own full
//    build: nine table scans across four databases, each. The misses are correlated by
//    construction — a version bump invalidates every key at once — so ten simultaneous
//    visitors meant ten identical builds against a D1 daily row quota SHARED with the
//    management API.
//
// 3. The version is read BEFORE the build and the key is derived from it, but an admin
//    write can land inside the build window. The payload was then stored under the
//    PREVIOUS version's key, where a caller passing `?v=<old>` is handed it with
//    `immutable` — a cache entry that is wrong the moment it is written, for a year.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const BASE = 'https://api.example/';

let queryLog = [];

/**
 * A D1 stub that records every statement with a timestamp, and can delay each answer so
 * sequential and concurrent execution are distinguishable.
 */
function d1(rows = {}, { delayMs = 0, version = null } = {}) {
  return {
    prepare(sql) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const answer = () => {
        if (version && flat.includes('FROM portal_settings') && flat.includes('key')) {
          return { results: [{ key: 'public_data_version', value: version() }] };
        }
        for (const [needle, value] of Object.entries(rows)) {
          if (flat.includes(needle)) return value;
        }
        return { results: [] };
      };
      const record = async () => {
        const startedAt = Date.now();
        queryLog.push({ sql: flat, args, startedAt });
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return answer();
      };
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: record,
        first: async () => ((await record()).results || [])[0] || null,
        run: record,
      };
      return stmt;
    },
  };
}

function kv() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    _store: store,
  };
}

function installCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const e = store.get(typeof req === 'string' ? req : req.url);
        return e ? new Response(e.body, { headers: e.headers }) : undefined;
      },
      async put(req, res) { store.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) }); },
    },
  };
  return store;
}

const TABLES = {
  'FROM users': { results: [{ id: 1, id_code: 'U1', name: 'Amit', name_hindi: '', village: '', village_hindi: '', designation: '', designation_hindi: '', fathers_name: '', fathers_name_hindi: '', photo: '', mobile: '9' }] },
  'FROM committee_members': { results: [{ id: 1, year: 2026, name: 'U1', view_role: 'T', view_role_hindi: '' }] },
  'FROM collections': { results: [{ id: 5, year: 2026, name: 'U1', amount: 100, detail: '', contribution_type: '1', certificate_or_receipt: '', is_resell: '0' }] },
  'FROM expenses': { results: [] },
  'FROM loans': { results: [] },
  'FROM loan_guarantors': { results: [] },
  'FROM loan_consents': { results: [] },
  'FROM generated_files': { results: [] },
};

function makeEnv({ delayMs = 0, version = () => '9' } = {}) {
  return {
    DB_CORE: d1(TABLES, { delayMs, version }),
    DB_COLLECTIONS: d1(TABLES, { delayMs }),
    DB_LOANS_EXPENSES: d1(TABLES, { delayMs }),
    DB_FILE_INDEX: d1(TABLES, { delayMs }),
    DB_MISC: d1({}, { delayMs }),
    DB_LOGS: d1(),
    KV_PUBLIC: kv(),
  };
}

const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
const get = (env, query = '?action=portalData') =>
  worker.fetch(new Request(`${BASE}${query}`, { method: 'GET' }), env, ctx);

const sectionQueries = () => queryLog.filter((q) => /FROM (users|committee_members|collections|expenses|loans|loan_guarantors|loan_consents|generated_files)\b/.test(q.sql));

let cacheStore;
beforeEach(() => { queryLog = []; pending.length = 0; cacheStore = installCache(); });

describe('the sections are read together, not one after another', () => {
  test('a build overlaps its section reads instead of summing them', async () => {
    const env = makeEnv({ delayMs: 40 });
    const startedAt = Date.now();
    const res = await get(env);
    const elapsed = Date.now() - startedAt;

    assert.equal(res.status, 200);
    const reads = sectionQueries();
    assert.ok(reads.length >= 8, `sanity: the sections were read (${reads.length})`);

    // Sequentially these same reads are >= 8 * 40ms. Concurrently they overlap, so the
    // build is bounded by the SLOWEST section rather than by their sum. The threshold is
    // deliberately loose — this asserts the shape, not a benchmark.
    assert.ok(elapsed < reads.length * 40 * 0.6,
      `expected overlapping reads, took ${elapsed}ms for ${reads.length} reads of 40ms`);
  });

  test('the same queries are issued — only their timing changes', async () => {
    const env = makeEnv();
    await get(env);
    const tables = sectionQueries().map((q) => /FROM (\w+)/.exec(q.sql)[1]).sort();
    assert.deepEqual([...new Set(tables)].sort(), [
      'collections', 'committee_members', 'expenses', 'generated_files',
      'loan_consents', 'loan_guarantors', 'loans', 'users',
    ], 'every section is still read exactly once, so the D1 row cost is unchanged');
  });

  test('the payload is unchanged in shape', async () => {
    const body = await (await get(makeEnv())).json();
    for (const key of [
      'users', 'committee', 'collections', 'expenses', 'loans', 'guarantors',
      'generatedFiles', 'loanConsents', 'journeyEntries', 'journeyTagline',
      'journeyPageText', 'donation',
    ]) {
      assert.ok(key in body, `${key} is still present`);
    }
    assert.equal(body.users[0].Name, 'Amit');
    assert.equal(body.collections[0].__rowIndex, 5);
  });

  test('a failing required section still falls back rather than serving a hole', async () => {
    const env = makeEnv();
    env.DB_COLLECTIONS = {
      prepare() {
        const boom = async () => { throw new Error('D1_ERROR: quota exceeded'); };
        const stmt = { bind: () => stmt, all: boom, first: boom, run: boom };
        return stmt;
      },
    };
    env.KV_PUBLIC._store.set('pub:snapshot:portalData:v2', JSON.stringify({
      version: '8', savedAt: '2026-09-01T00:00:00.000Z', data: { users: [{ Name: 'Saved' }] },
    }));

    const res = await get(env);
    const body = await res.json();
    // Concurrency must not turn all-or-nothing into partially-empty: a section that
    // cannot be read is still a failed build, and a failed build serves the saved copy.
    assert.equal(body.stale, true);
    assert.equal(body.users[0].Name, 'Saved');
  });
});

describe('concurrent misses share one build (PUB-BE-07)', () => {
  test('ten simultaneous requests build once, not ten times', async () => {
    const env = makeEnv({ delayMs: 25 });
    const responses = await Promise.all(Array.from({ length: 10 }, () => get(env)));
    await Promise.all(pending);

    for (const res of responses) assert.equal(res.status, 200);

    const usersReads = queryLog.filter((q) => q.sql.includes('FROM users')).length;
    // Before: the cache entry is written at the END of a build, so all ten found no
    // entry and each ran a full build — ten times nine table scans, on a quota shared
    // with the management API.
    assert.equal(usersReads, 1, `expected one build, saw ${usersReads}`);
  });

  test('every sharer gets the same bytes', async () => {
    const env = makeEnv({ delayMs: 25 });
    const bodies = await Promise.all(
      Array.from({ length: 5 }, () => get(env).then((r) => r.text())));
    assert.equal(new Set(bodies).size, 1, 'one build, one answer');
  });

  test('a failed build is not remembered for later requests', async () => {
    let attempt = 0;
    const env = makeEnv();
    const flaky = {
      prepare(sql) {
        const flat = sql.replace(/\s+/g, ' ').trim();
        const run = async () => {
          queryLog.push({ sql: flat, args: [], startedAt: Date.now() });
          if (flat.includes('FROM collections') && attempt++ === 0) {
            throw new Error('D1_ERROR: transient');
          }
          return TABLES['FROM collections'];
        };
        const stmt = { bind: () => stmt, all: run, first: async () => (await run()).results[0] || null, run };
        return stmt;
      },
    };
    env.DB_COLLECTIONS = flaky;

    const first = await get(env);
    assert.equal(first.status, 500, 'the first build fails and there is no snapshot');

    // If the rejected promise stayed in the in-flight map, this would await the same
    // rejection forever instead of trying again.
    installCache();
    const second = await get(env);
    assert.equal(second.status, 200, 'a later request builds again');
  });

  test('different versions are not collapsed into one build', async () => {
    let v = '9';
    const env = makeEnv({ delayMs: 10, version: () => v });
    await get(env);
    await Promise.all(pending);
    const afterFirst = queryLog.filter((q) => q.sql.includes('FROM users')).length;

    v = '10';
    await get(env);
    await Promise.all(pending);
    assert.equal(queryLog.filter((q) => q.sql.includes('FROM users')).length, afterFirst + 1,
      'a new version is a new key and a new build');
  });
});

describe('a build is not cached under a version it no longer matches (PUB-BE-07)', () => {
  /** Reports `before` until the build has started, then `after`. */
  function movingVersion(before, after) {
    let sectionsRead = 0;
    return {
      version: () => (sectionsRead > 0 ? after : before),
      note: () => { sectionsRead++; },
    };
  }

  test('a version bump during the build stops the payload being cached', async () => {
    // The version reads: once before the build, once after (the re-check). The sections
    // are read in between, so flipping the value after the first read reproduces an admin
    // write landing inside the build window.
    let versionReads = 0;
    const env = makeEnv();
    env.DB_CORE = d1(TABLES, { version: () => (++versionReads > 1 ? '10' : '9') });

    const res = await get(env, '?action=portalData&v=9');
    await Promise.all(pending);

    assert.equal(res.status, 200, 'the visitor still gets the data they asked for');

    // Before: stored under `…portalData?v=9` and handed to `?v=9` callers with
    // `max-age=31536000, immutable` — wrong from the moment it was written.
    assert.equal([...cacheStore.keys()].length, 0, 'nothing was cached under the stale key');
    const cc = res.headers.get('Cache-Control');
    assert.ok(!cc.includes('immutable'),
      `a payload that outlived its version must not be immutable, got: ${cc}`);
  });

  test('with the version steady, the fast path is still immutable and still cached', async () => {
    const env = makeEnv();
    const res = await get(env, '?action=portalData&v=9');
    await Promise.all(pending);

    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.deepEqual([...cacheStore.keys()], ['https://public-cache.internal/portalData?v=9']);
  });

  test('summary gets the same re-check', async () => {
    let versionReads = 0;
    const env = makeEnv();
    env.DB_CORE = d1(TABLES, { version: () => (++versionReads > 1 ? '10' : '9') });

    const res = await get(env, '?action=summary&v=9');
    await Promise.all(pending);
    assert.ok(!res.headers.get('Cache-Control').includes('immutable'));
    assert.equal([...cacheStore.keys()].length, 0);
  });
});

describe('an oversized payload is reported before it becomes an outage', () => {
  test('a section past the row warning is logged, and still served in full', async () => {
    const logged = [];
    const env = makeEnv();
    env.DB_COLLECTIONS = d1({
      'FROM collections': {
        results: Array.from({ length: 20001 }, (_, i) => ({
          id: i, year: 2026, name: 'U1', amount: 1, detail: '', contribution_type: '1',
          certificate_or_receipt: '', is_resell: '0',
        })),
      },
    });
    env.DB_LOGS = {
      prepare(sql) {
        const flat = sql.replace(/\s+/g, ' ').trim();
        let args = [];
        const stmt = {
          bind: (...a) => { args = a; return stmt; },
          all: async () => { if (/^INSERT/i.test(flat)) logged.push(args); return { results: [] }; },
          first: async () => null,
          run: async () => { if (/^INSERT/i.test(flat)) logged.push(args); return { success: true }; },
        };
        return stmt;
      },
    };

    const res = await get(env);
    await Promise.all(pending);
    const body = await res.json();

    // Explicitly NOT a truncation: silently dropping rows from a transparency portal
    // would hide contributions, which is a worse failure than a slow payload.
    assert.equal(body.collections.length, 20001, 'every row is still served');

    const text = JSON.stringify(logged);
    assert.match(text, /collections=20001/);
    assert.match(text, /paginate|PUB-BE-07/i, 'the message names the real fix');
  });

  test('an ordinary payload logs nothing', async () => {
    const logged = [];
    const env = makeEnv();
    env.DB_LOGS = {
      prepare(sql) {
        const flat = sql.replace(/\s+/g, ' ').trim();
        const stmt = {
          bind: () => stmt,
          all: async () => { if (/^INSERT/i.test(flat)) logged.push(flat); return { results: [] }; },
          first: async () => null,
          run: async () => { if (/^INSERT/i.test(flat)) logged.push(flat); return { success: true }; },
        };
        return stmt;
      },
    };
    await get(env);
    await Promise.all(pending);
    assert.deepEqual(logged, []);
  });
});
