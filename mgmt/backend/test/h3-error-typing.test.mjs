// ============ AUDIT H-3 — every user-facing message was thrown as a bare Error ============
//
// The router classifies a thrown error by looking for `err.expected`. Only
// AuthError / PermissionError / ValidationError set it, so ~107 `throw new
// Error('Valid year required')`-style messages — plain input validation, "not
// found", "already exists" — were treated as UNEXPECTED server faults. Each one:
//
//   1. answered HTTP 500 instead of 400, so infra could not tell "the operator
//      left a field blank" from "the Worker is broken";
//   2. had its message REPLACED by "Something went wrong on the server", so the
//      operator was never told which field was wrong; and
//   3. was written to error_log, burying real defects under routine typos.
//
// These tests drive the REAL Worker (`worker.fetch`) over the stubs, so what is
// asserted is the actual HTTP status, the actual JSON body and the actual
// error_log contents — not a re-implementation of the router's branching.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import worker from '../src/index.js';
import { login, hashPassword, ValidationError, InternalError, PermissionError } from '../src/auth.js';

const SRC_DIR = new URL('../src/', import.meta.url);

// ---------------------------------------------------------------- test harness

function makeCtx() {
  const pending = [];
  return {
    ctx: { waitUntil: (p) => pending.push(p) },
    // The router logs through ctx.waitUntil, which in a real Worker outlives the
    // response. Await it before asserting on error_log.
    settle: () => Promise.all(pending.map(p => Promise.resolve(p).catch(() => {}))),
  };
}

async function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('USER0001', 9876543210, 'a@b.test', await hashPassword('a-good-password'), 'Superadmin', '2026-01-01').run();

  return {
    DB_CORE: core,
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
    ALLOWED_ORIGINS: 'https://portal.test',
    // R2 deliberately absent -> exercises the InternalError(+userMessage) path.
  };
}

// One real request through the router. Returns status + parsed body + the rows
// the request caused to be written to error_log.
async function call(env, body) {
  const { ctx, settle } = makeCtx();
  const before = await env.DB_LOGS.prepare('SELECT COUNT(*) AS n FROM error_log').first('n');
  const res = await worker.fetch(
    new Request('https://api.test/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://portal.test' },
      body: JSON.stringify(body),
    }),
    env,
    ctx
  );
  const json = await res.json();
  await settle();
  const logged = (await env.DB_LOGS.prepare(
    'SELECT source, page, message, stack FROM error_log ORDER BY rowid'
  ).all()).results.slice(Number(before));
  return { status: res.status, json, logged };
}

async function tokenFor(env) {
  const r = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'Firefox');
  assert.equal(r.success, true, 'test fixture login must succeed');
  return r.token;
}

// =================================================================== 1. THE BUG

test('H-3: a blank required field answers 400 with the real message and is NOT logged', async () => {
  const env = await makeEnv();
  const token = await tokenFor(env);

  // views.js addYear(): `if (!y) throw ... ('Valid year required')`.
  const r = await call(env, { action: 'addYear', token, year: '' });

  // BEFORE the fix this block read: status 500, message 'Something went wrong on
  // the server...', logged.length 1.
  assert.equal(r.status, 400, 'a missing input is a client error, not a server error');
  assert.equal(r.json.success, false);
  assert.equal(r.json.message, 'Valid year required', 'the operator must be told WHAT was wrong');
  assert.equal(r.json.error, true, 'the frontend still keys off `error: true`');
  assert.deepEqual(r.logged, [], 'routine validation must not reach the Error Log');
});

test('H-3: a genuine server fault STILL answers 500, is generic, and IS logged', async () => {
  const env = await makeEnv();
  const token = await tokenFor(env);

  // Break a binding the handler needs so it throws for real (not a validation
  // error). This proves the fix did not blanket-mark everything `expected` and
  // blind the Error Log.
  env.DB_LOANS_EXPENSES = {
    prepare() { throw new Error('D1_ERROR: no such table: main.expenses at offset 21'); },
  };
  const r = await call(env, { action: 'getExpenses', token, year: 2026 });

  assert.equal(r.status, 500);
  assert.equal(
    r.json.message,
    'Something went wrong on the server. Please try again; the committee has been notified.',
    'an unexpected fault must never echo internal detail'
  );
  assert.ok(!r.json.message.includes('no such table'), 'no schema detail leaks to the caller');
  assert.equal(r.logged.length, 1, 'a real fault must be recorded');
  assert.match(r.logged[0].message, /no such table: main\.expenses/, 'the log keeps the RAW message');
  assert.ok(r.logged[0].stack, 'and the stack, for debugging');
});

// ==================================== 2. SWEEP: many messages, one shared rule

// Each entry: a request that must be rejected, and the exact sentence the
// operator has to see. These cover five different modules so the classification
// is verified broadly, not on one lucky handler.
const USER_FACING = [
  ['addYear',               { year: '' },                       'Valid year required'],            // views.js
  ['getUserProfile',        { userId: '' },                      'User ID required'],               // views.js
  ['retryQueueJob',         { jobId: '' },                       'jobId is required.'],             // collectionQueue.js
  ['retryQueueJob',         { jobId: 'JOB-does-not-exist' },     'Job not found.'],                 // collectionQueue.js
  ['addPersonTemplate',     { text: '   ' },                     'Template text required'],         // whatsapp.js
  ['deletePersonTemplate',  { rowIndex: '' },                    'rowIndex required'],              // whatsapp.js
  ['addWhatsappGroup',      { groupName: 'A', groupid: '' },     'Group name and Group ID required'], // whatsapp.js
  ['copyReceiptTemplate',   { fromYear: 2025, toYear: '' },      'Target year required'],           // templates.js
  ['deleteReceiptTemplate', { year: 2026 },                      'Template not found.'],            // templates.js
  ['reportErrorToWhatsApp', { errorId: '' },                     'errorId required'],               // errorLog.js
  ['reportErrorToWhatsApp', { errorId: 'ERR-nope' },             'Error record not found.'],        // errorLog.js
  ['lockYear',              { year: '' },                        'Valid year required'],            // auth.js
];

for (const [action, extra, expectedMessage] of USER_FACING) {
  test(`H-3 sweep: ${action} -> 400 "${expectedMessage}"`, async () => {
    const env = await makeEnv();
    const token = await tokenFor(env);
    const r = await call(env, { action, token, ...extra });

    assert.equal(r.status, 400, `${action} must be a 400`);
    assert.equal(r.json.message, expectedMessage);
    assert.deepEqual(r.logged, [], `${action} must not write to error_log`);
  });
}

// ============================== 3. InternalError CARRIES A SAFE USER SENTENCE

test('H-3: InternalError(raw, userMessage) shows the safe sentence, logs the raw one', async () => {
  const env = await makeEnv();
  const token = await tokenFor(env);

  // storage.moveYearToDrive with no R2 binding: a genuine misconfiguration (500,
  // logged) that still owes the Superadmin a specific "no files were moved".
  const r = await call(env, { action: 'moveYearToDrive', token, year: 2026 });

  assert.equal(r.status, 500, 'a missing binding is a server fault');
  assert.equal(
    r.json.message,
    'File storage is not set up on the server, so no files were moved. Please contact the Superadmin.'
  );
  assert.ok(!r.json.message.includes('env.R2'), 'the binding name must not leak to the caller');
  assert.equal(r.logged.length, 1, 'still logged, because it IS a fault');
  assert.match(r.logged[0].message, /R2 binding \(env\.R2\) is not configured/, 'the log gets the raw detail');
});

test('H-3: an InternalError WITHOUT a userMessage still gets the generic text', async () => {
  const e = InternalError('DB_MISC binding not configured');
  assert.equal(e.userMessage, undefined);
  assert.equal(e.expected, undefined, 'InternalError must NOT be expected — it has to be logged');
  assert.equal(e.internal, true);
});

test('H-3: the "nothing was changed" reassurance survives an aborted write', async () => {
  const env = await makeEnv();
  const token = await tokenFor(env);

  // crud.updateRecordByIdx aborts when it cannot read the row's year. The operator
  // is mid-edit: they must learn the record was NOT half-written.
  const realPrepare = env.DB_COLLECTIONS.prepare.bind(env.DB_COLLECTIONS);
  env.DB_COLLECTIONS.prepare = (sql) => {
    if (/SELECT year FROM/i.test(sql)) throw new Error('D1_ERROR: network error');
    return realPrepare(sql);
  };

  const r = await call(env, {
    action: 'updateRecord', token, sheet: 'COLLECTIONS', rowIndex: 12, payload: { Amount: 100 },
  });

  assert.equal(r.status, 500);
  assert.match(r.json.message, /Nothing was changed/, 'the operator must be told the row is untouched');
  assert.ok(!r.json.message.includes('D1_ERROR'), 'the raw D1 text must not be echoed');
  assert.ok(
    r.logged.some(l => /year lookup on .* failed/.test(l.message)),
    'the raw cause is still in the Error Log'
  );
});

// ===================================== 4. PERMISSION / AUTH STAY DISTINGUISHED

test('H-3: the fix did not flatten 400 / 403 / 401 into one status', async () => {
  const env = await makeEnv();

  // 401 — no token at all.
  const noAuth = await call(env, { action: 'getUserProfile', userId: 'USER0002' });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.authError, true);

  // 403 — authenticated, but the role is not allowed.
  await env.DB_CORE.prepare('UPDATE login_users SET role = ? WHERE name = ?').bind('Subadmin', 'USER0001').run();
  const token = await tokenFor(env);
  const forbidden = await call(env, { action: 'exportBackup', token });
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.json.message, /Superadmin/);

  // 400 — authenticated, allowed, bad input.
  const bad = await call(env, { action: 'getUserProfile', token, userId: '' });
  assert.equal(bad.status, 400);

  assert.deepEqual(
    [noAuth.logged.length, forbidden.logged.length, bad.logged.length], [0, 0, 0],
    'none of the three is a defect, so none may reach the Error Log'
  );
});

// ======================================= 5. STRUCTURAL GUARD (what CI enforces)

test('H-3 guard: no bare `throw new Error(...)` survives in mgmt/backend/src', () => {
  const offenders = [];
  for (const file of readdirSync(SRC_DIR).filter(f => f.endsWith('.js'))) {
    const lines = readFileSync(new URL(file, SRC_DIR), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('throw new Error(')) return;
      if (/^\s*(\/\/|\*)/.test(line)) return; // a comment quoting the old code
      offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    offenders, [],
    'Every throw must state its intent: ValidationError (user-facing, 400, not logged) '
    + 'or InternalError (server fault, 500, logged).\n' + offenders.join('\n')
  );
});

test('H-3 guard: the three error constructors keep their routing contract', () => {
  assert.equal(ValidationError('x').expected, true);
  assert.equal(ValidationError('x').authError, false);
  assert.equal(ValidationError('x').permission, undefined, 'validation is 400, not 403');

  assert.equal(PermissionError('x').expected, true);
  assert.equal(PermissionError('x').permission, true, 'permission is 403');

  assert.equal(InternalError('x').expected, undefined, 'internal faults must be logged');
});
