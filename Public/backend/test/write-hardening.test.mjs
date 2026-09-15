// ============ PUBLIC WORKER — THE TWO WRITE PATHS ============
//
// audit PUB-BE-06. `logError` and `savePushSubscription` are the only writes on this
// Worker, they are anonymous by necessity, and they had no authenticity control of any
// kind. The assumption worth naming is that CORS was one:
//
//   CORS does not stop a request. It stops the caller READING the response.
//
// A cross-origin POST still arrives and is still executed — the browser only refuses to
// hand the reply to the calling script. For a write the reply is not the point, the row
// is. And a POST with `Content-Type: text/plain` is a CORS *simple request*, so it never
// even gets a preflight for an origin allow-list to reject.
//
// So any page on the internet could insert rows into `error_log` (the table the
// committee reads to find out whether the public site is broken), and could insert or
// REACTIVATE a `push_subscriptions` row — `ON CONFLICT … active = 1` — turning back on a
// subscription a visitor had switched off.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const BASE = 'https://api.example/';
const ORIGIN = 'https://portal.example';

let writes = [];

function d1(rows = {}) {
  return {
    prepare(sql) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const isWrite = /^(INSERT|UPDATE|DELETE)/i.test(flat);
      const answer = () => {
        for (const [needle, value] of Object.entries(rows)) {
          if (flat.includes(needle)) return value;
        }
        return { results: [] };
      };
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: async () => { if (isWrite) writes.push({ sql: flat, args }); return answer(); },
        first: async () => (answer().results || [])[0] || null,
        run: async () => { if (isWrite) writes.push({ sql: flat, args }); return { success: true }; },
      };
      return stmt;
    },
  };
}

/** A D1 stub whose writes fail, to prove the status code tells the truth. */
function brokenD1() {
  return {
    prepare() {
      const fail = async () => { throw new Error('D1_ERROR: disk I/O error'); };
      const stmt = { bind: () => stmt, all: fail, first: fail, run: fail };
      return stmt;
    },
  };
}

function kv() {
  const map = new Map();
  return { async get(k) { return map.has(k) ? map.get(k) : null; }, async put(k, v) { map.set(k, v); } };
}

function makeEnv(overrides = {}) {
  return {
    DB_CORE: d1(),
    DB_COLLECTIONS: d1(),
    DB_LOANS_EXPENSES: d1(),
    DB_FILE_INDEX: d1(),
    DB_MISC: d1(),
    DB_LOGS: d1(),
    KV_PUBLIC: kv(),
    ...overrides,
  };
}

const ctx = { waitUntil: () => {} };

/** A well-formed browser write, which every negative case below varies one thing from. */
function post(action, body, { origin = ORIGIN, contentType = 'application/json', headers = {} } = {}) {
  const h = { ...headers };
  if (origin !== null) h.Origin = origin;
  if (contentType !== null) h['Content-Type'] = contentType;
  return new Request(`${BASE}?action=${action}`, {
    method: 'POST',
    headers: h,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const GOOD_REPORT = { page: '/members', message: 'TypeError: x is not a function', stack: 'at f()', context: '{}' };
const GOOD_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BKxQ', auth: 'aUtH' },
};

beforeEach(() => { writes = []; globalThis.caches = undefined; });

describe('a write must declare JSON (PUB-BE-06)', () => {
  for (const contentType of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'application/json-patch+json']) {
    test(`Content-Type: ${contentType} is refused before any database work`, async () => {
      const res = await worker.fetch(post('logError', GOOD_REPORT, { contentType }), makeEnv(), ctx);
      // These are exactly the content types that make a POST a CORS *simple request*,
      // i.e. the ones that skip the preflight. Refusing them is what gives the origin
      // check below any power over a browser caller.
      assert.equal(res.status, 415);
      assert.equal(writes.length, 0);
    });
  }

  test('a missing Content-Type is refused', async () => {
    const res = await worker.fetch(post('logError', GOOD_REPORT, { contentType: null }), makeEnv(), ctx);
    assert.equal(res.status, 415);
    assert.equal(writes.length, 0);
  });

  test('application/json with a charset is accepted', async () => {
    const res = await worker.fetch(
      post('logError', GOOD_REPORT, { contentType: 'application/json; charset=utf-8' }), makeEnv(), ctx);
    assert.equal(res.status, 200);
  });
});

describe('a write must come from an approved origin (PUB-BE-06)', () => {
  test('with ALLOWED_ORIGINS set, only a listed origin may write', async () => {
    const env = makeEnv();
    env.ALLOWED_ORIGINS = `${ORIGIN}, https://www.portal.example`;

    assert.equal((await worker.fetch(post('logError', GOOD_REPORT), env, ctx)).status, 200);
    assert.equal(
      (await worker.fetch(post('logError', GOOD_REPORT, { origin: 'https://evil.example' }), env, ctx)).status,
      403);
    assert.equal(writes.length, 1, 'the rejected write never reached D1');
  });

  test('with ALLOWED_ORIGINS set, a write with NO origin is refused', async () => {
    const env = makeEnv();
    env.ALLOWED_ORIGINS = ORIGIN;
    // curl, a script, a server-side loop: no Origin header at all.
    const res = await worker.fetch(post('logError', GOOD_REPORT, { origin: null }), env, ctx);
    assert.equal(res.status, 403);
    assert.equal(writes.length, 0);
  });

  test('with ALLOWED_ORIGINS UNSET, a write still needs some origin', async () => {
    // The floor for an unconfigured deployment: every browser sets Origin on a
    // cross-origin POST, so a real visitor is unaffected, while the trivial scripted
    // flood that sets none is refused.
    const res = await worker.fetch(post('logError', GOOD_REPORT, { origin: null }), makeEnv(), ctx);
    assert.equal(res.status, 403);
    assert.equal(writes.length, 0);
  });

  test('with ALLOWED_ORIGINS UNSET, a browser write is still accepted', async () => {
    const res = await worker.fetch(post('logError', GOOD_REPORT), makeEnv(), ctx);
    assert.equal(res.status, 200);
  });

  test('an explicit "*" keeps the wildcard posture for writes too', async () => {
    const env = makeEnv();
    env.ALLOWED_ORIGINS = '*';
    const res = await worker.fetch(post('logError', GOOD_REPORT, { origin: 'https://anywhere.example' }), env, ctx);
    assert.equal(res.status, 200, 'an operator who asked for a wildcard gets one');
  });
});

describe('a write body is bounded and must have a shape (PUB-BE-06)', () => {
  test('an oversized body is refused, header or no header', async () => {
    const huge = { ...GOOD_REPORT, stack: 'x'.repeat(9000) };
    const res = await worker.fetch(post('logError', huge), makeEnv(), ctx);
    assert.equal(res.status, 413);
    assert.equal(writes.length, 0);
  });

  test('a lying Content-Length cannot get a large body past the cap', async () => {
    const huge = { ...GOOD_REPORT, stack: 'x'.repeat(9000) };
    const res = await worker.fetch(
      post('logError', huge, { headers: { 'Content-Length': '10' } }), makeEnv(), ctx);
    // The cap is enforced on the bytes actually read, not on a header the caller sets.
    assert.equal(res.status, 413);
  });

  test('an empty body is refused instead of being written as a blank row', async () => {
    const res = await worker.fetch(post('logError', '', {}), makeEnv(), ctx);
    assert.equal(res.status, 400);
    assert.equal(writes.length, 0);
  });

  for (const junk of ['not json at all', '{"unclosed":', '[1,2,3]', '"a string"', 'null', '42']) {
    test(`a junk body (${junk.slice(0, 18)}) is refused`, async () => {
      const res = await worker.fetch(post('logError', junk, {}), makeEnv(), ctx);
      // Before: an unparseable body was swallowed into `{}` and written as a row with
      // no message — indistinguishable from a real error that had no message.
      assert.equal(res.status, 400);
      assert.equal(writes.length, 0);
    });
  }

  test('an error report with no message is refused', async () => {
    for (const body of [{}, { message: '' }, { message: '   ' }, { page: '/x' }]) {
      const res = await worker.fetch(post('logError', body), makeEnv(), ctx);
      assert.equal(res.status, 400, `refused: ${JSON.stringify(body)}`);
    }
    assert.equal(writes.length, 0);
  });

  test('a report whose fields are the wrong type is refused', async () => {
    for (const body of [
      { message: 'x', page: { nested: true } },
      { message: 'x', stack: 42 },
      { message: 'x', context: 7 },
    ]) {
      assert.equal((await worker.fetch(post('logError', body), makeEnv(), ctx)).status, 400);
    }
  });

  test('a genuine report is still written', async () => {
    const res = await worker.fetch(post('logError', GOOD_REPORT), makeEnv(), ctx);
    assert.equal(res.status, 200);
    assert.equal(writes.length, 1);
    assert.match(writes[0].sql, /INSERT INTO error_log/i);
  });
});

describe('the status code tells the truth (PUB-BE-06)', () => {
  test('a failed error-log write is 503, not 200', async () => {
    const res = await worker.fetch(post('logError', GOOD_REPORT), makeEnv({ DB_LOGS: brokenD1() }), ctx);
    // Before: 200 whether the row was written or lost, so a logger that had stopped
    // working looked exactly like one that was fine.
    assert.equal(res.status, 503);
  });

  test('a rejected subscription is 400 and a failed write is 503', async () => {
    const bad = await worker.fetch(post('savePushSubscription', { endpoint: 'https://', keys: {} }), makeEnv(), ctx);
    assert.equal(bad.status, 400, "the caller's fault");

    const broken = await worker.fetch(post('savePushSubscription', GOOD_SUB), makeEnv({ DB_CORE: brokenD1() }), ctx);
    assert.equal(broken.status, 503, 'ours');
  });

  test('a write is never cached', async () => {
    const res = await worker.fetch(post('logError', GOOD_REPORT), makeEnv(), ctx);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });
});

describe('a push endpoint is parsed, not pattern-matched (PUB-BE-06)', () => {
  const refused = [
    'https://',
    'https://localhost/push',
    'https://LOCALHOST/push',
    'https://printer.local/push',
    'https://10.0.0.1/push',
    'https://127.0.0.1:8080/push',
    'https://[::1]/push',
    'https://user:pw@fcm.googleapis.com/fcm/send/x',
    'https://internal-service/push',
    'http://fcm.googleapis.com/fcm/send/x',
    'httpsx://fcm.googleapis.com/x',
    'https:// spaced.example/x',
  ];

  for (const endpoint of refused) {
    test(`refuses ${endpoint}`, async () => {
      const res = await worker.fetch(
        post('savePushSubscription', { ...GOOD_SUB, endpoint }), makeEnv(), ctx);
      // The stored endpoint is a delivery target the mgmt Worker later POSTs to, so what
      // is written here decides where a future request is sent. The old check was
      // `/^https:\/\//i.test(endpoint)`, which accepts every string above except the
      // last two.
      assert.equal(res.status, 400, `${endpoint} must not be stored`);
      assert.equal(writes.length, 0);
    });
  }

  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://web.push.apple.com/QABC',
    'https://sin.notify.windows.com/w/?token=abc',
  ]) {
    test(`accepts a real push service endpoint (${new URL(endpoint).hostname})`, async () => {
      const res = await worker.fetch(post('savePushSubscription', { ...GOOD_SUB, endpoint }), makeEnv(), ctx);
      assert.equal(res.status, 200);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].args[0], endpoint, 'stored exactly as sent');
    });
  }

  test('an over-long endpoint is refused rather than truncated', async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${'a'.repeat(600)}`;
    const res = await worker.fetch(post('savePushSubscription', { ...GOOD_SUB, endpoint }), makeEnv(), ctx);
    // Truncating to the 500-character cap invents a DIFFERENT URL and stores it as if
    // the visitor had sent it.
    assert.equal(res.status, 400);
    assert.equal(writes.length, 0);
  });

  test('a subscription missing its keys is refused', async () => {
    for (const body of [
      { endpoint: GOOD_SUB.endpoint, keys: { p256dh: 'BKxQ' } },
      { endpoint: GOOD_SUB.endpoint, keys: { auth: 'aUtH' } },
      { endpoint: GOOD_SUB.endpoint },
    ]) {
      assert.equal((await worker.fetch(post('savePushSubscription', body), makeEnv(), ctx)).status, 400);
    }
    assert.equal(writes.length, 0);
  });

  test('the flattened shape and the nested PushSubscription shape both still work', async () => {
    const flat = { endpoint: GOOD_SUB.endpoint, p256dh: 'BKxQ', auth: 'aUtH' };
    assert.equal((await worker.fetch(post('savePushSubscription', flat), makeEnv(), ctx)).status, 200);
    assert.equal((await worker.fetch(post('savePushSubscription', { subscription: GOOD_SUB }), makeEnv(), ctx)).status, 200);
  });
});

describe('the read paths are untouched', () => {
  test('a GET read needs no Origin and no Content-Type', async () => {
    const env = makeEnv({
      DB_CORE: d1({ 'FROM portal_settings': { results: [{ key: 'public_data_version', value: '4' }] } }),
    });
    env.ALLOWED_ORIGINS = ORIGIN;
    const res = await worker.fetch(new Request(`${BASE}?action=dataVersion`, { method: 'GET' }), env, ctx);
    assert.equal(res.status, 200, 'this is a public read-only portal');
    assert.deepEqual(await res.json(), { v: '4' });
  });

  test('the preflight still advertises what a write accepts', async () => {
    const env = makeEnv();
    env.ALLOWED_ORIGINS = ORIGIN;
    const res = await worker.fetch(
      new Request(`${BASE}?action=logError`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    assert.match(res.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
    // Without this the browser would preflight every single report.
    assert.equal(res.headers.get('Access-Control-Max-Age'), '86400');
  });
});
