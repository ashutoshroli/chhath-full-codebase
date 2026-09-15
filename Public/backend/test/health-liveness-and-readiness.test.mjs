// ============ PUBLIC WORKER — HEALTH: LIVENESS vs READINESS ============
//
// audit PUB-BE-03. `GET ?health=1` used to run six D1 round-trips and a KV read on
// every single call, and it sits before the rate limiter on purpose (so a monitor
// cannot throttle itself). A monitor polling every 30s therefore spent ~17,000 D1
// round-trips a day answering "is the Worker running?" — a question that needs
// none — and any anonymous caller could multiply that at will against a D1 quota
// SHARED with the management API. The same response handed out raw D1 error text.
//
// The two questions are now separate:
//
//   ?health=1            liveness   — no I/O at all; this is what a monitor polls
//   ?health=1&deep=1     readiness  — dependency probes, edge-cached for 60s,
//                                     rate-limited, detail gated behind HEALTH_TOKEN

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const BASE = 'https://api.example/';

let prepared = [];
let kvReads = 0;

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

/** A D1 stub whose every query rejects, to exercise the error path. */
function brokenD1(message) {
  return {
    prepare(sql) {
      prepared.push(sql.replace(/\s+/g, ' ').trim());
      const fail = async () => { throw new Error(message); };
      const stmt = { bind: () => stmt, all: fail, first: fail, run: fail };
      return stmt;
    },
  };
}

function kv() {
  const map = new Map();
  return {
    async get(k) { kvReads++; return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, v); },
  };
}

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

function makeEnv(overrides = {}) {
  return {
    DB_CORE: d1(() => ({ results: [{ key: 'public_data_version', value: '9' }] })),
    DB_COLLECTIONS: d1(),
    DB_LOANS_EXPENSES: d1(),
    DB_FILE_INDEX: d1(),
    DB_MISC: d1(),
    DB_LOGS: d1(),
    KV_PUBLIC: kv(),
    ...overrides,
  };
}

let env;
let cacheStore;
const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };

async function call(path, init = {}) {
  const res = await worker.fetch(new Request(BASE + path, init), env, ctx);
  await Promise.all(pending.splice(0));
  return res;
}

beforeEach(() => {
  prepared = [];
  kvReads = 0;
  env = makeEnv();
  cacheStore = installCache();
});

describe('liveness costs nothing (PUB-BE-03)', () => {
  test('?health=1 does no database and no KV work at all', async () => {
    const res = await call('?health=1');

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.check, 'liveness');
    assert.equal(body.healthy, true);
    // `status` is what the existing monitors read.
    assert.equal(body.status, true);
    // The whole point: six D1 round-trips and a KV read per poll, gone.
    assert.equal(prepared.length, 0, `expected no D1 work, got: ${prepared.join(' | ')}`);
    assert.equal(kvReads, 0);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });

  test('a hundred liveness polls still do no I/O', async () => {
    for (let i = 0; i < 100; i++) await call('?health=1');
    assert.equal(prepared.length, 0);
    assert.equal(kvReads, 0);
  });

  test('a missing required binding is still caught — without any I/O', async () => {
    env = makeEnv({ DB_FILE_INDEX: undefined });
    const res = await call('?health=1');

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.healthy, false);
    assert.deepEqual(body.missingRequired, ['DB_FILE_INDEX']);
    assert.equal(prepared.length, 0);
  });

  test('a missing OPTIONAL binding does not make the Worker look dead', async () => {
    env = makeEnv({ DB_MISC: undefined, DB_LOGS: undefined });
    const res = await call('?health=1');
    assert.equal(res.status, 200);
  });

  test('?action=x&health=1 is a request for x, not a health probe', async () => {
    const res = await call('?action=dataVersion&health=1');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).v, '9');
  });
});

describe('readiness probes dependencies, but not on demand (PUB-BE-03)', () => {
  test('a deep probe reports every dependency and its state', async () => {
    const res = await call('?health=1&deep=1');

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.check, 'readiness');
    assert.equal(body.ready, true);
    assert.equal(body.degraded, false);
    assert.equal(body.checks.DB_CORE.state, 'ok');
    assert.equal(body.checks.DB_CORE.required, true);
    assert.equal(body.checks.KV_PUBLIC.state, 'ok');
    assert.equal(body.checks.DB_MISC.required, false);
    assert.ok(prepared.length >= 6, 'a deep probe does touch every database');
  });

  test('?health=ready is the same probe', async () => {
    const res = await call('?health=ready');
    assert.equal((await res.json()).check, 'readiness');
  });

  test('repeated deep probes reuse one 60s edge-cached result', async () => {
    await call('?health=1&deep=1');
    const afterFirst = prepared.length;
    assert.ok(afterFirst >= 6);

    for (let i = 0; i < 10; i++) {
      const res = await call('?health=1&deep=1');
      assert.equal((await res.json()).cached, true);
    }
    // Ten more probes, zero extra dependency round-trips.
    assert.equal(prepared.length, afterFirst);
    assert.equal([...cacheStore.keys()].filter((k) => k.includes('/readiness')).length, 1);
  });

  test('a failing REQUIRED dependency is 503 and not ready', async () => {
    env = makeEnv({ DB_COLLECTIONS: brokenD1('no such table: collections') });
    const res = await call('?health=1&deep=1');

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ready, false);
    assert.equal(body.checks.DB_COLLECTIONS.state, 'error');
  });

  test('a failing OPTIONAL dependency is degraded, not down', async () => {
    env = makeEnv({ DB_MISC: brokenD1('D1_ERROR: connection lost') });
    const res = await call('?health=1&deep=1');

    assert.equal(res.status, 200, 'a silently-off feature must not page anyone');
    const body = await res.json();
    assert.equal(body.ready, true);
    assert.equal(body.degraded, true);
    assert.equal(body.checks.DB_MISC.state, 'error');
    // The operator is told WHAT it costs, without being told the SQL error.
    assert.equal(body.checks.DB_MISC.consequence, 'popups will not appear');
  });
});

describe('database internals stay out of an anonymous response (PUB-BE-03)', () => {
  const SECRET_ERROR = 'no such column: users.password_hash in database chhath-core';

  test('an anonymous caller gets states, never the D1 error text', async () => {
    env = makeEnv({ DB_CORE: brokenD1(SECRET_ERROR) });
    const res = await call('?health=1&deep=1');

    const raw = await res.text();
    assert.ok(!raw.includes('password_hash'), `leaked the D1 error: ${raw}`);
    assert.ok(!raw.includes('chhath-core'));
    const body = JSON.parse(raw);
    assert.equal(body.checks.DB_CORE.state, 'error');
    assert.equal(body.errors, undefined);
    assert.match(body.detail, /redacted/);
  });

  test('the withheld messages are written to the error log instead', async () => {
    const logged = [];
    env = makeEnv({
      DB_CORE: brokenD1(SECRET_ERROR),
      DB_LOGS: {
        prepare(sql) {
          const stmt = {
            bind: (...args) => { logged.push({ sql, args }); return stmt; },
            all: async () => ({ results: [] }),
            first: async () => null,
            run: async () => ({ success: true }),
          };
          return stmt;
        },
      },
    });

    await call('?health=1&deep=1');

    const insert = logged.find((l) => /INSERT INTO error_log/i.test(l.sql));
    assert.ok(insert, 'the readiness failure must be recorded');
    assert.ok(JSON.stringify(insert.args).includes('password_hash'), 'the operator needs the real message in the log');
  });

  test('the full detail is released to a caller holding HEALTH_TOKEN', async () => {
    env = makeEnv({ DB_CORE: brokenD1(SECRET_ERROR), HEALTH_TOKEN: 'a-long-shared-secret' });

    const viaHeader = await call('?health=1&deep=1', { headers: { 'X-Health-Token': 'a-long-shared-secret' } });
    const body = await viaHeader.json();
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.join(' ').includes('password_hash'));

    const viaQuery = await call('?health=1&deep=1&token=a-long-shared-secret');
    assert.ok((await viaQuery.json()).errors.length > 0);
  });

  test('a wrong or absent token gets no detail, even when one is configured', async () => {
    env = makeEnv({ DB_CORE: brokenD1(SECRET_ERROR), HEALTH_TOKEN: 'a-long-shared-secret' });

    for (const headers of [{}, { 'X-Health-Token': 'wrong' }, { 'X-Health-Token': 'a-long-shared-secre' }]) {
      const res = await call('?health=1&deep=1', { headers });
      const raw = await res.text();
      assert.ok(!raw.includes('password_hash'), `leaked with headers ${JSON.stringify(headers)}`);
    }
  });

  test('an UNSET HEALTH_TOKEN does not mean "open to everyone"', async () => {
    env = makeEnv({ DB_CORE: brokenD1(SECRET_ERROR) }); // no HEALTH_TOKEN configured
    const res = await call('?health=1&deep=1&token=');
    assert.ok(!(await res.text()).includes('password_hash'));
  });
});
