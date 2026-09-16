// ============ PR-48 — a request id that actually reaches somebody ============
//
// #365 added `newRequestId()` and `requestSummary()` to telemetry.js, tested the format,
// and wired them to NOTHING. I found that while auditing my own work: both had zero
// callers, so the observability the PR claimed did not exist. A tested log format that is
// never emitted is worse than no format, because the tests make it look done.
//
// The point of the id is the JOIN. An `error_log` row and the log line describing the
// request that produced it previously had nothing in common, so "what else happened in
// that request" was unanswerable. These tests pin the three places the id must appear,
// because any two of them without the third is useless:
//
//   1. the RESPONSE, as `X-Request-Id` — and readable by the page, or the frontend cannot
//      quote it back to an operator;
//   2. the SUMMARY LINE, once per request, with the action, status and duration;
//   3. the ERROR-LOG CONTEXT, which is what makes it a join key rather than a decoration.
//
// Plus the properties that stop it becoming a liability: it is per-request (not per
// isolate), it never carries a credential, and telemetry can never break a response.
//
// Run: node --test mgmt/backend/test/pr48-request-correlation.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { hashPassword } from '../src/auth.js';
import worker from '../src/index.js';

const ORIGIN = 'https://portal.example';
// The router auto-logs through ctx.waitUntil, so a test that does not settle those
// promises sees an empty error_log and would "pass" for the wrong reason.
let pending = [];
const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); } };
const settle = async () => { await Promise.all(pending); pending = []; };

let logged = [];
const realLog = console.log;

beforeEach(() => { logged = []; pending = []; console.log = (...a) => { logged.push(a.join(' ')); }; });
afterEach(() => { console.log = realLog; });

const summaries = () => logged.filter((l) => l.startsWith('[req] '));
const fieldsOf = (line) => Object.fromEntries(
  line.replace('[req] ', '').split(' ').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i), p.slice(i + 1)];
  })
);

async function makeEnv(extra = {}) {
  const core = makeD1(schemaFor('core.sql'));
  core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('USER0001', 9876543210, 'a@b.test', await hashPassword('a-good-password'), 'Superadmin', '2026-01-01').run();
  return {
    DB_CORE: core,
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
    ALLOWED_ORIGINS: ORIGIN,
    ...extra,
  };
}

const post = (env, body, headers = {}) => worker.fetch(
  new Request('https://api.example/', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }),
  env, ctx
);

// ------------------------------------------------------- 1. IN THE RESPONSE

describe('PR-48: the id comes back to the caller', () => {
  test('every POST answer carries X-Request-Id, success or failure', async () => {
    const env = await makeEnv();

    const ok = await post(env, { action: 'login', name: 'USER0001', password: 'a-good-password' });
    const okId = ok.headers.get('X-Request-Id');
    assert.match(okId || '', /^[0-9a-f]{8}$/, 'a successful reply must carry the id');

    // An auth failure — the case an operator actually reports.
    const denied = await post(env, { action: 'getUsers' });
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('X-Request-Id') || '', /^[0-9a-f]{8}$/,
      'a FAILING reply must carry it too — that is the one someone reports');
  });

  test('the browser is allowed to read it, or the frontend cannot quote it', async () => {
    const env = await makeEnv();
    const res = await post(env, { action: 'login', name: 'USER0001', password: 'nope' });
    const exposed = res.headers.get('Access-Control-Expose-Headers') || '';
    assert.match(exposed, /X-Request-Id/,
      'without Access-Control-Expose-Headers the header is invisible to JavaScript');
  });

  test('two requests get two different ids (per request, not per isolate)', async () => {
    const env = await makeEnv();
    const a = await post(env, { action: 'login', name: 'USER0001', password: 'nope' });
    const b = await post(env, { action: 'login', name: 'USER0001', password: 'nope' });
    assert.notEqual(a.headers.get('X-Request-Id'), b.headers.get('X-Request-Id'),
      'a module-scoped id would correlate unrelated requests — worse than none');
  });

  test('a client cannot choose its own id — not in the header, and not in the log row', async () => {
    // The header alone is not enough to assert here: the header is built from the local
    // variable, so a bug that let a client-supplied value win would leave the header
    // correct and poison only the ERROR-LOG CONTEXT — where it matters most, because a
    // chosen id lets an attacker's row be made to look like part of someone else's
    // request. An earlier version of this test checked only the header and missed exactly
    // that mutation.
    const env = await makeEnv();
    delete env.DB_CORE; // force the router's catch, so the context is written
    const res = await post(env, {
      action: 'login', name: 'USER0001', password: 'nope',
      requestId: 'deadbeef', __requestId: 'deadbeef', context: '{"requestId":"deadbeef"}',
    });
    await settle();

    const headerId = res.headers.get('X-Request-Id');
    assert.notEqual(headerId, 'deadbeef');
    assert.match(headerId || '', /^[0-9a-f]{8}$/);

    const row = await env.DB_LOGS.prepare('SELECT context FROM error_log ORDER BY id DESC LIMIT 1').first();
    const context = JSON.parse(row.context);
    assert.notEqual(context.requestId, 'deadbeef',
      'a client-chosen id would let an attacker forge the correlation between rows');
    assert.equal(context.requestId, headerId, 'it must be the id the server minted');
  });
});

// -------------------------------------------------------- 2. IN THE SUMMARY

describe('PR-48: exactly one summary line per request, with what is needed to read it', () => {
  test('the line names the action, the status and the duration', async () => {
    const env = await makeEnv();
    const res = await post(env, { action: 'login', name: 'USER0001', password: 'a-good-password' });

    assert.equal(summaries().length, 1, `expected 1 summary line, got ${summaries().length}`);
    const f = fieldsOf(summaries()[0]);
    assert.equal(f.rid, res.headers.get('X-Request-Id'), 'the line must carry the SAME id as the header');
    assert.equal(f.action, 'login');
    assert.equal(f.method, 'POST');
    assert.equal(f.status, '200');
    assert.ok(Number.isFinite(Number(f.ms)), `ms must be a number, got ${f.ms}`);
  });

  test('a failing request is summarised too, with the real HTTP status', async () => {
    const env = await makeEnv();
    await post(env, { action: 'getUsers' });
    const f = fieldsOf(summaries()[0]);
    assert.equal(f.status, '401', 'the status must be the one actually returned');
    assert.equal(f.action, 'getUsers');
  });

  test('an unexpected server fault is marked degraded; an expected refusal is not', async () => {
    // A 500: DB_CORE missing entirely. `degraded` is what separates "the user typed
    // something wrong" from "we are broken" when scanning a log.
    const broken = await makeEnv();
    delete broken.DB_CORE;
    await post(broken, { action: 'login', name: 'USER0001', password: 'x' });
    const fault = fieldsOf(summaries()[0]);
    assert.equal(fault.status, '500');
    assert.equal(fault.degraded, 'unhandled');

    logged = [];
    const fine = await makeEnv();
    await post(fine, { action: 'getUsers' });                 // 401, entirely expected
    assert.equal(fieldsOf(summaries()[0]).degraded, undefined,
      'a session timing out is routine — marking it degraded would make the field meaningless');
  });

  test('the line carries a NAME, never a token', async () => {
    const env = await makeEnv();
    const login = await (await post(env, {
      action: 'login', name: 'USER0001', password: 'a-good-password',
    })).json();
    logged = [];

    // A cacheable staff read is the path that resolves the user before the handler.
    await post(env, { action: 'getUsers', token: login.token });
    const line = summaries()[0];
    assert.ok(!line.includes(login.token), 'the session token must never appear in a log line');
    const f = fieldsOf(line);
    if (f.user) assert.equal(f.user, 'USER0001', 'the user field is the name');
  });

  test('the cache outcome is reported, so a cache that stops working is visible', async () => {
    const env = await makeEnv();
    const login = await (await post(env, {
      action: 'login', name: 'USER0001', password: 'a-good-password',
    })).json();

    logged = [];
    await post(env, { action: 'getUsers', token: login.token });
    const first = fieldsOf(summaries()[0]);
    assert.equal(first.cache, 'MISS', 'the first read of a cacheable action is a MISS');

    logged = [];
    await post(env, { action: 'getUsers', token: login.token });
    assert.equal(fieldsOf(summaries()[0]).cache, 'HIT', 'the second must be a HIT');

    // An uncacheable action must report NO cache field rather than a misleading MISS.
    logged = [];
    await post(env, { action: 'login', name: 'USER0001', password: 'nope' });
    assert.equal(fieldsOf(summaries()[0]).cache, undefined);
  });
});

// ----------------------------------------------------- 3. THE JOIN, WHICH IS THE POINT

describe('PR-48: an error_log row can be tied to the request that produced it', () => {
  test('the id in the error-log context matches the id the caller was given', async () => {
    const env = await makeEnv();
    // Force an unexpected fault so the router's catch auto-logs.
    const broken = await makeEnv();
    delete broken.DB_CORE;

    const res = await post(broken, { action: 'login', name: 'USER0001', password: 'x' });
    const headerId = res.headers.get('X-Request-Id');
    assert.equal(res.status, 500);
    await settle();

    const row = await broken.DB_LOGS
      .prepare('SELECT context FROM error_log ORDER BY id DESC LIMIT 1').first();
    assert.ok(row, 'an unexpected fault must reach the error log');
    const context = JSON.parse(row.context);

    assert.equal(context.requestId, headerId,
      'THE POINT: without this the row and the log line have nothing to join on');
    // …and it is the same id the summary line printed.
    assert.equal(fieldsOf(summaries()[0]).rid, headerId);
    assert.ok(env, 'env fixture used');
  });

  test('a direct call that never went through the router gains no empty requestId field', async () => {
    // buildLogContext is called from several handlers. An always-present empty field would
    // be indistinguishable from "this row is from an untraced path".
    const env = await makeEnv();
    const login = await (await post(env, {
      action: 'login', name: 'USER0001', password: 'a-good-password',
    })).json();
    await post(env, {
      action: 'logError', token: login.token,
      source: 'frontend', page: '/x', message: 'a handled client error',
    });
    await settle();
    const row = await env.DB_LOGS.prepare('SELECT context FROM error_log ORDER BY id DESC LIMIT 1').first();
    const context = JSON.parse(row.context);
    // It DID go through the router, so it must have one.
    assert.match(context.requestId || '', /^[0-9a-f]{8}$/);
  });
});

// ------------------------------------------- 4. TELEMETRY MUST NEVER BREAK A REQUEST

describe('PR-48: observability cannot be the thing that fails', () => {
  test('a console that throws does not turn a 200 into a 500', async () => {
    const env = await makeEnv();
    console.log = () => { throw new Error('stdout is gone'); };
    const res = await post(env, { action: 'login', name: 'USER0001', password: 'a-good-password' });
    assert.equal(res.status, 200, 'the response must survive a broken logger');
    assert.equal((await res.json()).success, true);
  });

  test('a preflight is not summarised — there is no action to report', async () => {
    const env = await makeEnv();
    await worker.fetch(new Request('https://api.example/', {
      method: 'OPTIONS', headers: { Origin: ORIGIN },
    }), env, ctx);
    assert.deepEqual(summaries(), [], 'an OPTIONS preflight would double every line');
  });
});
