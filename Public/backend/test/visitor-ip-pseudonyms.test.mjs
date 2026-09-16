// ============ PUBLIC WORKER — VISITOR ADDRESSES ARE NEVER STORED ============
//
// audit carry-over C12. `logError` is anonymous and is called by the visitor's
// BROWSER, not by the visitor: a JavaScript error is not something they did, chose or
// can see. Every such error used to write the visitor's IP address to `error_log`
// twice — once into the indexed `client_ip` column and once more into the JSON
// `context` as `edgeIp` — permanently, in a table the committee reads.
//
// The portal needs to know whether two requests came from the SAME visitor, to cap
// floods. It never needs the address. So the address is replaced by a keyed,
// daily-rotating pseudonym, and these tests pin the properties that make that claim
// true rather than decorative:
//
//   1. the raw address reaches NO database bind and NO stored JSON, on any path;
//   2. the flood cap still works, because the pseudonym is stable;
//   3. two different visitors do not collide into one pseudonym;
//   4. with no key available, NOTHING about the visitor is stored — it never falls
//      back to the address or to an unkeyed hash;
//   5. the unindexed `context LIKE '%edgeIp%'` scan is gone for good.
//
// Run: node --test Public/backend/test/visitor-ip-pseudonyms.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const BASE = 'https://api.example/';
const ORIGIN = 'https://portal.example';
const IP = '203.0.113.47';
const OTHER_IP = '198.51.100.9';

let statements = [];  // EVERY statement, not just writes
let kvPuts = [];

function d1(counts = {}) {
  return {
    prepare(sql) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: async () => { statements.push({ sql: flat, args }); return { results: [] }; },
        first: async () => {
          statements.push({ sql: flat, args });
          if (/COUNT\(\*\) AS n/i.test(flat)) return { n: counts.perIp ?? 0 };
          return null; // no dedup hit
        },
        run: async () => { statements.push({ sql: flat, args }); return { success: true }; },
      };
      return stmt;
    },
  };
}

function kv(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v, opts) { kvPuts.push({ key: k, value: v, opts }); map.set(k, v); },
    _map: map,
  };
}

function makeEnv(overrides = {}) {
  return { DB_LOGS: d1(), KV_PUBLIC: kv(), ...overrides };
}

const ctx = { waitUntil: () => {} };

function report(ip, body = {}) {
  return new Request(`${BASE}?action=logError`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({
      page: '/members',
      message: 'TypeError: x is not a function',
      stack: 'at f()',
      ...body,
    }),
  });
}

/** The INSERT into error_log, with its bound arguments. */
function insertRow() {
  const s = statements.find((x) => /^INSERT INTO error_log/i.test(x.sql));
  assert.ok(s, 'no error_log INSERT was issued');
  const cols = s.sql.slice(s.sql.indexOf('(') + 1, s.sql.indexOf(')')).split(',').map((c) => c.trim());
  // The VALUES list is not all placeholders — `reported` is the literal 0 — so
  // columns cannot be zipped straight onto args. Walk the VALUES list and consume a
  // bound argument only where there is actually a `?`.
  const vStart = s.sql.toUpperCase().indexOf('VALUES');
  const vals = s.sql
    .slice(s.sql.indexOf('(', vStart) + 1, s.sql.lastIndexOf(')'))
    .split(',').map((v) => v.trim());
  assert.equal(cols.length, vals.length, 'column list and VALUES list disagree');
  const row = {};
  let ai = 0;
  cols.forEach((c, i) => { row[c] = vals[i] === '?' ? s.args[ai++] : vals[i]; });
  return { row, statement: s };
}

/** Everything the Worker sent anywhere, as one string, for "does the IP appear" checks. */
function everythingSent() {
  return JSON.stringify({ statements, kvPuts });
}

beforeEach(() => { statements = []; kvPuts = []; });

describe('the visitor address never reaches storage', () => {
  test('the raw IP appears in NO statement and NO KV write', async () => {
    const res = await worker.fetch(report(IP), makeEnv(), ctx);
    assert.equal(res.status, 200);

    // The single assertion that matters most. Not "client_ip is a hash" — the
    // address must not appear ANYWHERE: not in a bind, not in a WHERE, not folded
    // into JSON, not as part of a KV key.
    assert.ok(
      !everythingSent().includes(IP),
      `the raw address ${IP} was sent to storage:\n${everythingSent()}`
    );
  });

  test('client_ip holds a 128-bit pseudonym, not the address', async () => {
    await worker.fetch(report(IP), makeEnv(), ctx);
    const { row } = insertRow();

    assert.notEqual(row.client_ip, IP);
    assert.match(row.client_ip, /^[0-9a-f]{32}$/, 'client_ip should be 32 hex chars');
  });

  test('a client cannot reinstate edgeIp through the context it supplies', async () => {
    // The old code wrote `context.edgeIp` itself. Now nothing does — and a caller
    // that sends the key must not get it stored either, or the column would come
    // back through the one field the client controls.
    await worker.fetch(
      report(IP, { context: JSON.stringify({ edgeIp: IP, screen: '390x844' }) }),
      makeEnv(), ctx
    );
    const { row } = insertRow();

    const stored = JSON.parse(row.context);
    assert.equal(stored.edgeIp, undefined, 'edgeIp must be stripped from the stored context');
    assert.equal(stored.screen, '390x844', 'the rest of the context is still kept');
  });

  test('the unindexed context-LIKE scan is gone', async () => {
    await worker.fetch(report(IP), makeEnv(), ctx);
    // It could never match a pseudonym, and it was a leading-wildcard scan on an
    // anonymous endpoint — exactly what migration 09 was written to remove.
    const scan = statements.find((s) => /context LIKE/i.test(s.sql));
    assert.equal(scan, undefined, `a LIKE scan was still issued: ${scan && scan.sql}`);
  });
});

describe('the flood cap still works', () => {
  test('the per-IP count is issued, keyed on the pseudonym', async () => {
    await worker.fetch(report(IP), makeEnv(), ctx);

    const count = statements.find((s) => /COUNT\(\*\) AS n FROM error_log WHERE client_ip/i.test(s.sql));
    assert.ok(count, 'the per-visitor cap query was not issued');
    const { row } = insertRow();
    // Counted and stored under the SAME value, or the cap counts nothing.
    assert.equal(count.args[0], row.client_ip);
  });

  test('the same visitor gets the same pseudonym, so the cap accumulates', async () => {
    const env = makeEnv(); // one env => one KV => one salt
    await worker.fetch(report(IP), env, ctx);
    const first = insertRow().row.client_ip;

    statements = [];
    await worker.fetch(report(IP, { message: 'a different error' }), env, ctx);
    const second = insertRow().row.client_ip;

    assert.equal(first, second, 'a stable pseudonym is what makes the cap countable');
  });

  test('two different visitors do not collide', async () => {
    const env = makeEnv();
    await worker.fetch(report(IP), env, ctx);
    const a = insertRow().row.client_ip;

    statements = [];
    await worker.fetch(report(OTHER_IP), env, ctx);
    const b = insertRow().row.client_ip;

    assert.notEqual(a, b, 'distinct visitors sharing a pseudonym would cap each other');
  });

  test('over the cap, the write is refused with 429', async () => {
    const env = makeEnv({ DB_LOGS: d1({ perIp: 20 }) }); // PUBLIC_LOG_MAX_PER_IP
    const res = await worker.fetch(report(IP), env, ctx);

    assert.equal(res.status, 429);
    assert.equal((await res.json()).rateLimited, true);
    assert.ok(!statements.some((s) => /^INSERT INTO error_log/i.test(s.sql)), 'nothing should be written');
  });
});

describe('the key rotates, and without one nothing is stored', () => {
  test('the salt is random, dated, and given a TTL', async () => {
    await worker.fetch(report(IP), makeEnv(), ctx);

    const put = kvPuts.find((p) => p.key.startsWith('pub:ipsalt:'));
    assert.ok(put, 'no salt was written');
    // Dated, so it rotates by itself...
    assert.match(put.key, /^pub:ipsalt:\d{4}-\d{2}-\d{2}$/);
    // ...and expiring is the point: once a day's salt is gone, that day's rows
    // cannot be tied back to an address by anyone, us included.
    assert.ok(put.opts && put.opts.expirationTtl > 0, 'the salt must expire');
    assert.match(put.value, /^[0-9a-f]{64}$/, 'the salt should be 32 random bytes');
  });

  test('an existing salt is reused rather than rewritten on every error', async () => {
    const env = makeEnv();
    await worker.fetch(report(IP), env, ctx);
    await worker.fetch(report(OTHER_IP), env, ctx);

    const puts = kvPuts.filter((p) => p.key.startsWith('pub:ipsalt:'));
    assert.equal(puts.length, 1, 'the salt should be written once per period, not per request');
  });

  test('a different salt gives a different pseudonym for the same visitor', async () => {
    // This is what daily rotation buys: yesterday's row and today's row for one
    // visitor are not linkable to each other.
    const day1 = makeEnv({ KV_PUBLIC: kv({ [`pub:ipsalt:${new Date().toISOString().slice(0, 10)}`]: 'a'.repeat(64) }) });
    await worker.fetch(report(IP), day1, ctx);
    const withSaltA = insertRow().row.client_ip;

    statements = [];
    const day2 = makeEnv({ KV_PUBLIC: kv({ [`pub:ipsalt:${new Date().toISOString().slice(0, 10)}`]: 'b'.repeat(64) }) });
    await worker.fetch(report(IP), day2, ctx);
    const withSaltB = insertRow().row.client_ip;

    assert.notEqual(withSaltA, withSaltB);
  });

  test('with no KV, nothing about the visitor is stored — and the error still is', async () => {
    const env = { DB_LOGS: d1() }; // no KV_PUBLIC, no KV_SESSIONS => no key
    const res = await worker.fetch(report(IP), env, ctx);

    // The error report is what the committee needs; it must not be lost over this.
    assert.equal(res.status, 200);
    const { row } = insertRow();
    // The important part: it does NOT fall back to the address, and does NOT fall
    // back to an unkeyed hash (which for an IPv4 is 2^32 to reverse — the address
    // with extra steps). It stores nothing.
    assert.equal(row.client_ip, '');
    assert.ok(!everythingSent().includes(IP), 'the raw address leaked when KV was absent');
    // With no pseudonym there is nothing to count, so the D1 cap is skipped rather
    // than counting every visitor together as one.
    assert.ok(!statements.some((s) => /COUNT\(\*\) AS n FROM error_log WHERE client_ip/i.test(s.sql)));
  });

  test('a KV that throws is treated as no key, not as a reason to store the address', async () => {
    const angry = {
      async get() { throw new Error('KV unavailable'); },
      async put() { throw new Error('KV unavailable'); },
    };
    const res = await worker.fetch(report(IP), makeEnv({ KV_PUBLIC: angry }), ctx);

    assert.equal(res.status, 200);
    assert.equal(insertRow().row.client_ip, '');
    assert.ok(!everythingSent().includes(IP));
  });
});
