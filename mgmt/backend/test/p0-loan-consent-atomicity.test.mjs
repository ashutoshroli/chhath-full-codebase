// ====== AUDIT P0-01 — a loan may never commit without its four consent rows ======
//
// H-8 fixed "loan + guarantors in one transaction". The four `loan_consents` rows
// were still written AFTER that transaction, one .run() at a time, inside a
// try/catch that returned `{ success: true, consentWarning }`. So any failure
// there (D1 blip, isolate eviction, a bad participant) left a FINANCIALLY
// COMMITTED loan with 0-3 of its 4 legal consent records, and:
//
//   * the admin saw a success,
//   * `recomputeLoanStatus` reads whatever consent rows exist, so a loan missing
//     one row can be Approved with a participant who never consented,
//   * the suggested recovery is impossible: resendConsent() needs an existing
//     consent_id and cannot create the missing row.
//
// The consent rows are now minted before any write and inserted in the SAME
// batch() as the loan and the guarantors: all eight rows land, or none do.
// Only the WhatsApp/email invitations stay after the commit — and those ARE
// retryable with Resend, because the row they need exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import {
  saveLoanTransaction,
  buildLoanConsentRows,
  consentInsertStatements,
} from '../src/loans.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const le = makeD1(schemaFor('loans_expenses.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  for (const [code, name] of [['USER0002', 'Ram'], ['USER0003', 'Shyam'], ['USER0004', 'Gita'], ['USER0005', 'Sita']]) {
    core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp) VALUES (?,?,?,?)')
      .bind(code, name, 9800000001, 9800000001).run();
  }
  collections.prepare('INSERT INTO collections (year, name, amount) VALUES (?,?,?)')
    .bind(2026, 'USER0002', 1000000).run();
  return {
    DB_CORE: core,
    DB_LOANS_EXPENSES: le,
    DB_COLLECTIONS: collections,
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    KV_SESSIONS: makeKV(),
    CONSENT_BASE_URL: 'https://portal.test',
  };
}

const LOAN = { Year: 2026, Name: 'USER0002', Amount: 50000, 'Intrest Rate': 12, Tenure: 1 };
const GUARANTORS = [{ Guarantor: 'USER0003' }, { Guarantor: 'USER0004' }, { Guarantor: 'USER0005' }];
const loan = (over = {}) => ({ ...LOAN, ...over });
const guarantors = () => GUARANTORS.map(g => ({ ...g }));
const count = (db, sql) => db.prepare(sql).first('n');

// Fails the Nth `INSERT INTO loan_consents` the way a D1 blip would.
function failConsentInsert(env, nth) {
  const realPrepare = env.DB_LOANS_EXPENSES.prepare.bind(env.DB_LOANS_EXPENSES);
  let seen = 0;
  env.DB_LOANS_EXPENSES.prepare = (sql) => {
    if (/INSERT INTO loan_consents/.test(sql) && ++seen === nth) {
      return {
        bind: () => ({
          async run() { throw new Error('D1_ERROR: network error'); },
          async all() { throw new Error('D1_ERROR: network error'); },
          async first() { throw new Error('D1_ERROR: network error'); },
        }),
      };
    }
    return realPrepare(sql);
  };
}

// ============================== 1. EVERY consent position is transactional

for (const nth of [1, 2, 3, 4]) {
  test(`P0-01: consent insert #${nth} failing rolls the whole loan back`, async () => {
    const env = makeEnv();
    failConsentInsert(env, nth);

    await assert.rejects(
      () => saveLoanTransaction(env, loan(), guarantors(), SUPERADMIN),
      /D1_ERROR: network error/,
      'the caller must be told the loan was NOT saved'
    );

    // On `main` these find 1 loan, 3 guarantors and (nth-1) consents, and the
    // caller was told `{ success: true }`.
    assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 0,
      'no loan may survive a failed consent write');
    assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_guarantors'), 0,
      'and no guarantor rows either');
    assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 0,
      'and no partial consent rows');
  });
}

// ============================== 2. A SUCCESSFUL save is complete

test('P0-01: a successful save records all four consents, one per participant', async () => {
  const env = makeEnv();
  const res = await saveLoanTransaction(env, loan(), guarantors(), SUPERADMIN);
  assert.equal(res.success, true);

  const { results } = await env.DB_LOANS_EXPENSES
    .prepare('SELECT consent_id, loan_id, person_id, role, token, status, send_count FROM loan_consents ORDER BY id').all();
  assert.equal(results.length, 4);
  assert.deepEqual(results.map(r => r.role), ['loaner', 'guarantor', 'guarantor', 'guarantor']);
  assert.deepEqual(results.map(r => r.person_id), ['USER0002', 'USER0003', 'USER0004', 'USER0005']);
  for (const r of results) {
    assert.equal(r.loan_id, res.loanId, 'every consent is keyed to the loan');
    assert.equal(r.status, 'pending');
    assert.equal(r.send_count, 1);
    assert.ok(r.token && r.token.length >= 16, 'a real token was minted');
    assert.ok(r.consent_id && r.consent_id !== '', 'a consent id was minted');
  }
  const tokens = new Set(results.map(r => r.token));
  const ids = new Set(results.map(r => r.consent_id));
  assert.equal(tokens.size, 4, 'tokens are unique');
  assert.equal(ids.size, 4, 'consent ids are unique');
});

// ============================== 3. DELIVERY failure must NOT undo the loan

test('P0-01: an invitation-send failure keeps the loan and its consents', async () => {
  const env = makeEnv();
  // usersByIdCodes runs inside the delivery step only, so breaking DB_CORE reads
  // after the commit simulates "the rows are in, sending blew up".
  const realCorePrepare = env.DB_CORE.prepare.bind(env.DB_CORE);
  let armed = false;
  env.DB_CORE.prepare = (sql) => {
    if (armed && /FROM users/i.test(sql)) {
      return { bind: () => ({ async all() { throw new Error('D1_ERROR: read failed'); } }) };
    }
    return realCorePrepare(sql);
  };
  const realBatch = env.DB_LOANS_EXPENSES.batch.bind(env.DB_LOANS_EXPENSES);
  env.DB_LOANS_EXPENSES.batch = async (stmts) => { const r = await realBatch(stmts); armed = true; return r; };

  const res = await saveLoanTransaction(env, loan(), guarantors(), SUPERADMIN);

  assert.equal(res.success, true);
  assert.match(res.consentWarning || '', /consent records were saved/i,
    'the admin is told the records exist and only sending failed');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 4,
    'all four consents are present, so Resend can actually work');
});

// ============================== 4. The helpers stay pure / batchable

test('P0-01: buildLoanConsentRows does no I/O and covers every participant', () => {
  const rows = buildLoanConsentRows('LN-test', LOAN, GUARANTORS);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => r.role), ['loaner', 'guarantor', 'guarantor', 'guarantor']);
  assert.ok(rows.every(r => r.loanId === 'LN-test'));
  assert.ok(rows.every(r => typeof r.createdAt === 'string' && r.createdAt.includes('T')));
  assert.equal(new Set(rows.map(r => r.token)).size, 4);
});

test('P0-01: consentInsertStatements returns one bound statement per consent', () => {
  const env = makeEnv();
  const prepared = [];
  const realPrepare = env.DB_LOANS_EXPENSES.prepare.bind(env.DB_LOANS_EXPENSES);
  env.DB_LOANS_EXPENSES.prepare = (sql) => { prepared.push(sql); return realPrepare(sql); };

  const stmts = consentInsertStatements(env, buildLoanConsentRows('LN-test', LOAN, GUARANTORS));

  assert.equal(stmts.length, 4);
  assert.equal(prepared.length, 4);
  assert.ok(prepared.every(sql => /INSERT INTO loan_consents/.test(sql)));
});
