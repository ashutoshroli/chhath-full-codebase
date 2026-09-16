// ============ AUDIT H-8 — saveLoanTransaction / deleteLoanTransaction ============
//
// SAVE wrote the loan row, awaited it, and THEN wrote the three guarantors in a
// separate batch. A failure in between left a committed loan with zero
// guarantors — unrecoverable through the UI, because the approval rule, every
// consent and the repayment gate all read the guarantor rows. The admin saw
// `{ success: true }`.
//
// DELETE never touched `loan_consents`. Each of those rows holds a live `token`
// that was WhatsApped to four people, and the consent page is PUBLIC and
// authenticates on that token alone — so deleting a loan looked like it revoked
// access while in fact every link kept working. It also ran three unprotected
// statements, called `loanerId.toString()` unguarded, and enforced the year lock
// against the CLIENT-supplied year rather than the row's stored one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { saveLoanTransaction, deleteLoanTransaction } from '../src/loans.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const le = makeD1(schemaFor('loans_expenses.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  // Four members: the receiver and three guarantors.
  for (const [code, name] of [['USER0002', 'Ram'], ['USER0003', 'Shyam'], ['USER0004', 'Gita'], ['USER0005', 'Sita']]) {
    core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp) VALUES (?,?,?,?)')
      .bind(code, name, 9800000001, 9800000001).run();
  }
  // Enough 2026 collection surplus that a 50,000 loan is within the yearly
  // budget cap (saveLoanTransaction enforces amount <= surplus − loans given).
  collections.prepare('INSERT INTO collections (year, name, amount) VALUES (?,?,?)').bind(2026, 'USER0002', 1000000).run();
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

const count = (db, sql, ...args) => db.prepare(sql).bind(...args).first('n');
const rows = async (db, sql) => (await db.prepare(sql).all()).results.map(r => ({ ...r }));

// Seed a loan directly, the way a save leaves it, so delete can be tested without
// depending on the consent/WhatsApp side effects.
async function seedLoan(env, { year = 2026, loanId = 'LN-abc123', name = 'USER0002' } = {}) {
  const r = await env.DB_LOANS_EXPENSES
    .prepare('INSERT INTO loans (year, name, amount, loan_id, loan_status) VALUES (?,?,?,?,?)')
    .bind(year, name, 50000, loanId, 'Created').run();
  for (const g of ['USER0003', 'USER0004', 'USER0005']) {
    await env.DB_LOANS_EXPENSES
      .prepare('INSERT INTO loan_guarantors (year, loaner, guarantor, loan_id) VALUES (?,?,?,?)')
      .bind(year, name, g, loanId).run();
  }
  // The four consent rows a save creates, each with a live token.
  for (const [person, role, token] of [
    [name, 'loaner', 'tok-loaner'], ['USER0003', 'guarantor', 'tok-g1'],
    ['USER0004', 'guarantor', 'tok-g2'], ['USER0005', 'guarantor', 'tok-g3'],
  ]) {
    await env.DB_LOANS_EXPENSES.prepare(
      'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES (?,?,?,?,?,?)'
    ).bind('CN-' + token, loanId, person, role, token, 'sent').run();
  }
  return { rowIndex: r.meta.last_row_id, loanId };
}

// ============================================ 1. SAVE IS ONE TRANSACTION

test('H-8: a loan and its three guarantors are written in ONE transaction', async () => {
  const env = makeEnv();
  const batches = [];
  const realBatch = env.DB_LOANS_EXPENSES.batch.bind(env.DB_LOANS_EXPENSES);
  env.DB_LOANS_EXPENSES.batch = (stmts) => { batches.push(stmts.length); return realBatch(stmts); };

  await saveLoanTransaction(env, loan(), guarantors(), SUPERADMIN);

  // Before H-8: the loan was a standalone .run(), then batch([g1, g2, g3]) -> [3].
  // After H-8: batch([loan, g1, g2, g3]) -> [4], but the four consent rows were
  // still written one .run() at a time afterwards (audit P0-01).
  // Now: one batch carries the loan, the three guarantors AND the four consents.
  assert.deepEqual(batches, [8], 'one batch carrying the loan + guarantors + all four consents');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_guarantors'), 3);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 4);
});

test('H-8: if a guarantor insert fails, the LOAN is rolled back too', async () => {
  const env = makeEnv();

  // Make the third guarantor's INSERT fail, the way a D1 blip or a bad payload
  // would. Under the old code the loan row was already committed by then.
  const realPrepare = env.DB_LOANS_EXPENSES.prepare.bind(env.DB_LOANS_EXPENSES);
  let guarantorInserts = 0;
  env.DB_LOANS_EXPENSES.prepare = (sql) => {
    if (/INSERT INTO loan_guarantors/.test(sql) && ++guarantorInserts === 3) {
      return { bind: () => ({ async run() { throw new Error('D1_ERROR: network error'); } }) };
    }
    return realPrepare(sql);
  };

  await assert.rejects(
    () => saveLoanTransaction(env, loan(), guarantors(), SUPERADMIN),
    /D1_ERROR: network error/
  );

  // THE ASSERTION THAT FAILS ON `main` (it finds 1 loan and 0 guarantors):
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 0,
    'no orphaned loan may survive a failed guarantor write');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_guarantors'), 0,
    'and no partial guarantor rows either');
});

test('H-8 regression guard: a successful save still records everything it used to', async () => {
  const env = makeEnv();
  const res = await saveLoanTransaction(env, loan(), guarantors(), SUPERADMIN);

  assert.equal(res.success, true);
  assert.match(res.loanId, /^LN/, 'the caller still gets the generated Loan ID');

  const l = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loans').first();
  assert.equal(l.loan_id, res.loanId);
  assert.equal(l.loan_status, 'Created');
  assert.equal(l.created_by, 'USER0001');
  assert.equal(l.amount, 50000);

  const gs = await rows(env.DB_LOANS_EXPENSES, 'SELECT guarantor, loan_id, created_by FROM loan_guarantors ORDER BY guarantor');
  assert.deepEqual(gs.map(g => g.guarantor), ['USER0003', 'USER0004', 'USER0005']);
  assert.ok(gs.every(g => g.loan_id === res.loanId), 'every guarantor is stamped with the loan id');
  assert.ok(gs.every(g => g.created_by === 'USER0001'));
});

test('H-8 regression guard: the save-time validation rules still fire', async () => {
  const env = makeEnv();
  await assert.rejects(() => saveLoanTransaction(env, loan(), [{ Guarantor: 'USER0003' }], SUPERADMIN),
    /Exactly 3 guarantors required/);
  await assert.rejects(() => saveLoanTransaction(env, loan({ Amount: '' }), guarantors(), SUPERADMIN),
    /Missing required field/);
  await assert.rejects(
    () => saveLoanTransaction(env, loan(), [{ Guarantor: 'USER0003' }, { Guarantor: 'USER0003' }, { Guarantor: 'USER0004' }], SUPERADMIN),
    /must all be different/);

  // Nothing partial was left behind by any of the three rejections.
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 0);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_guarantors'), 0);
});

// ============================ 2. DELETE REVOKES THE OUTSTANDING CONSENT LINKS

test('H-8: deleting a loan revokes every outstanding consent token', async () => {
  const env = makeEnv();
  const { rowIndex, loanId } = await seedLoan(env);

  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 4,
    'four live links exist before the delete');

  const res = await deleteLoanTransaction(env, rowIndex, 2026, 'USER0002', SUPERADMIN, loanId);

  // THE ASSERTION THAT FAILS ON `main`: it finds all four consent rows intact,
  // tokens included, after the loan is gone.
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 0,
    'no consent row — and therefore no usable token — may outlive its loan');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 0);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_guarantors'), 0);

  assert.equal(res.removedConsents, 4, 'the count is reported so the activity log can record it');
  assert.equal(res.removedGuarantors, 3);
  assert.equal(res.loanId, loanId);
});

test('H-8: a token from a deleted loan can no longer be resolved', async () => {
  const env = makeEnv();
  const { rowIndex, loanId } = await seedLoan(env);

  // This is the lookup the PUBLIC consent page performs — token only, no session.
  const resolve = (token) => env.DB_LOANS_EXPENSES
    .prepare('SELECT consent_id, loan_id, person_id FROM loan_consents WHERE token = ?')
    .bind(token).first();

  assert.ok(await resolve('tok-g1'), 'the guarantor link works while the loan exists');
  await deleteLoanTransaction(env, rowIndex, 2026, 'USER0002', SUPERADMIN, loanId);
  assert.equal(await resolve('tok-g1'), null, 'and is dead afterwards');
  assert.equal(await resolve('tok-loaner'), null);
});

test('H-8: another loan\'s consents are NOT touched', async () => {
  const env = makeEnv();
  const a = await seedLoan(env, { loanId: 'LN-aaa' });
  // The other loan has to actually exist: the committed schema carries the
  // loan-relation triggers now, so a consent naming a loan that is not there is
  // refused. Which makes this fixture a closer match to a real database — the point of
  // the test is that deleting one loan leaves ANOTHER loan's consents alone, and that
  // other loan was previously a fiction.
  await env.DB_LOANS_EXPENSES.prepare('INSERT INTO loans (year, loan_id, name) VALUES (?,?,?)')
    .bind(2026, 'LN-bbb', 'USER0009').run();
  await env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES (?,?,?,?,?,?)'
  ).bind('CN-other', 'LN-bbb', 'USER0009', 'loaner', 'tok-other', 'sent').run();

  await deleteLoanTransaction(env, a.rowIndex, 2026, 'USER0002', SUPERADMIN, a.loanId);

  const left = await rows(env.DB_LOANS_EXPENSES, 'SELECT loan_id, token FROM loan_consents');
  assert.deepEqual(left, [{ loan_id: 'LN-bbb', token: 'tok-other' }],
    'only the deleted loan\'s consents go');
});

// ================================================= 3. DELETE IS ONE TRANSACTION

test('H-8: the delete is a single batch, so it cannot half-apply', async () => {
  const env = makeEnv();
  const { rowIndex, loanId } = await seedLoan(env);
  const sizes = [];
  const realBatch = env.DB_LOANS_EXPENSES.batch.bind(env.DB_LOANS_EXPENSES);
  env.DB_LOANS_EXPENSES.batch = (stmts) => { sizes.push(stmts.length); return realBatch(stmts); };

  await deleteLoanTransaction(env, rowIndex, 2026, 'USER0002', SUPERADMIN, loanId);
  assert.deepEqual(sizes, [3], 'loans + loan_guarantors + loan_consents in one transaction');
});

test('H-8: if any delete statement fails, NOTHING is deleted', async () => {
  const env = makeEnv();
  const { rowIndex, loanId } = await seedLoan(env);

  const realPrepare = env.DB_LOANS_EXPENSES.prepare.bind(env.DB_LOANS_EXPENSES);
  env.DB_LOANS_EXPENSES.prepare = (sql) => {
    if (/DELETE FROM loan_consents/.test(sql)) {
      return { bind: () => ({ async run() { throw new Error('D1_ERROR: disk I/O error'); } }) };
    }
    return realPrepare(sql);
  };

  await assert.rejects(
    () => deleteLoanTransaction(env, rowIndex, 2026, 'USER0002', SUPERADMIN, loanId),
    /disk I\/O error/
  );

  // The old code would already have removed the loan row by this point, leaving
  // guarantors and live consent tokens behind with no loan.
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_guarantors'), 3);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 4);
});

// ========================================= 4. THE UNGUARDED toString() AND FRIENDS

test('H-8: a legacy loan with no loan_id and no loanerId gives a message, not a TypeError', async () => {
  const env = makeEnv();
  // A row from before `loan_id` existed, and whose `name` is blank too.
  const r = await env.DB_LOANS_EXPENSES
    .prepare('INSERT INTO loans (year, name, amount) VALUES (?,?,?)').bind(2026, '', 50000).run();

  // On `main` this threw "Cannot read properties of null (reading 'toString')"
  // -> HTTP 500, generic message, a row in error_log, nothing deleted.
  const err = await deleteLoanTransaction(env, r.meta.last_row_id, 2026, null, SUPERADMIN, null)
    .then(() => null, e => e);
  assert.ok(err, 'it still refuses');
  assert.equal(err.expected, true, 'but as a user-facing message (HTTP 400, not logged)');
  assert.match(err.message, /no Loan ID and no receiver name/);
  assert.ok(!/toString/.test(err.message), 'not a raw TypeError');
});

test('H-8: a legacy loan WITH a loaner name still deletes its guarantors', async () => {
  const env = makeEnv();
  const r = await env.DB_LOANS_EXPENSES
    .prepare('INSERT INTO loans (year, name, amount) VALUES (?,?,?)').bind(2026, 'USER0002', 50000).run();
  for (const g of ['USER0003', 'USER0004']) {
    await env.DB_LOANS_EXPENSES.prepare('INSERT INTO loan_guarantors (year, loaner, guarantor) VALUES (?,?,?)')
      .bind(2026, 'USER0002', g).run();
  }
  // A different year's guarantors for the same loaner must survive.
  await env.DB_LOANS_EXPENSES.prepare('INSERT INTO loan_guarantors (year, loaner, guarantor) VALUES (?,?,?)')
    .bind(2025, 'USER0002', 'USER0005').run();

  const res = await deleteLoanTransaction(env, r.meta.last_row_id, 2026, 'USER0002', SUPERADMIN, null);
  assert.equal(res.removedGuarantors, 2);
  assert.equal(res.removedConsents, 0, 'a loan with no loan_id can have no consents');

  const left = await rows(env.DB_LOANS_EXPENSES, 'SELECT year, guarantor FROM loan_guarantors');
  assert.deepEqual(left, [{ year: 2025, guarantor: 'USER0005' }]);
});

test('H-8: the loaner name is recovered from the stored row when the client omits it', async () => {
  const env = makeEnv();
  const r = await env.DB_LOANS_EXPENSES
    .prepare('INSERT INTO loans (year, name, amount) VALUES (?,?,?)').bind(2026, 'USER0002', 50000).run();
  await env.DB_LOANS_EXPENSES.prepare('INSERT INTO loan_guarantors (year, loaner, guarantor) VALUES (?,?,?)')
    .bind(2026, 'USER0002', 'USER0003').run();

  const res = await deleteLoanTransaction(env, r.meta.last_row_id, 2026, undefined, SUPERADMIN, undefined);
  assert.equal(res.removedGuarantors, 1, 'stored.name is used rather than trusting the request');
});

test('H-8: a missing / already-deleted loan is a plain message', async () => {
  const env = makeEnv();
  for (const bad of [undefined, null, '', 0, 'abc']) {
    const e = await deleteLoanTransaction(env, bad, 2026, 'USER0002', SUPERADMIN, 'LN-x').then(() => null, x => x);
    assert.equal(e.expected, true, `rowIndex ${JSON.stringify(bad)} -> user-facing`);
    assert.match(e.message, /Could not tell which loan to delete/);
  }
  const gone = await deleteLoanTransaction(env, 4242, 2026, 'USER0002', SUPERADMIN, 'LN-x').then(() => null, x => x);
  assert.match(gone.message, /already been deleted/);
});

// ================================== 5. THE YEAR LOCK IS ENFORCED ON THE STORED ROW

test('H-8: a locked year cannot be bypassed by sending a different year', async () => {
  const env = makeEnv();
  // 2026 is locked. The loan lives in 2026.
  await env.DB_CORE.prepare('INSERT INTO locked_years (year, lockedby, lockedat) VALUES (?,?,?)')
    .bind(2026, 'USER0001', '2026-01-01').run();
  const { rowIndex, loanId } = await seedLoan(env, { year: 2026 });

  // The caller claims 2025 — unlocked — while rowIndex addresses the 2026 row.
  // On `main` this DELETED the loan: the lock was only ever checked against the
  // year in the request.
  const err = await deleteLoanTransaction(env, rowIndex, 2025, 'USER0002', SUPERADMIN, loanId)
    .then(() => null, e => e);

  assert.ok(err, 'the delete must be refused');
  assert.equal(err.permission, true, 'as a PermissionError (HTTP 403)');
  assert.match(err.message, /locked/);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1, 'the loan survives');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 4);
});

test('H-8: a locked year in the REQUEST is still honoured (checks are added, never swapped)', async () => {
  const env = makeEnv();
  // 2025 is locked; the loan is in unlocked 2026. Sending year=2025 must not
  // silently succeed just because the stored year is fine.
  await env.DB_CORE.prepare('INSERT INTO locked_years (year, lockedby, lockedat) VALUES (?,?,?)')
    .bind(2025, 'USER0001', '2026-01-01').run();
  const { rowIndex, loanId } = await seedLoan(env, { year: 2026 });

  await assert.rejects(
    () => deleteLoanTransaction(env, rowIndex, 2025, 'USER0002', SUPERADMIN, loanId), /locked/);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1);
});

test('H-8 regression guard: the ordinary delete of an unlocked loan still works', async () => {
  const env = makeEnv();
  const { rowIndex, loanId } = await seedLoan(env, { year: 2026 });
  const res = await deleteLoanTransaction(env, rowIndex, 2026, 'USER0002', SUPERADMIN, loanId);
  assert.equal(res.success, true);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 0);
});

test('H-8: a Subadmin still cannot delete a loan at all', async () => {
  const env = makeEnv();
  const { rowIndex, loanId } = await seedLoan(env);
  const err = await deleteLoanTransaction(env, rowIndex, 2026, 'USER0002', { name: 'USER0009', role: 'Subadmin' }, loanId)
    .then(() => null, e => e);
  assert.equal(err.permission, true);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1);
});

// ============================================================ 6. FREE TIER

test('H-8: the delete stays well inside the 50-subrequest cap', async () => {
  const env = makeEnv();
  const { rowIndex, loanId } = await seedLoan(env);
  let statements = 0;
  const real = env.DB_LOANS_EXPENSES.prepare.bind(env.DB_LOANS_EXPENSES);
  env.DB_LOANS_EXPENSES.prepare = (sql) => { statements++; return real(sql); };

  await deleteLoanTransaction(env, rowIndex, 2026, 'USER0002', SUPERADMIN, loanId);

  // 1 row lookup + 2 counts (for the activity log) + 3 batched deletes = 6,
  // and the 3 deletes travel as one batch. Before: 2 deletes, but no consent
  // cleanup, no stored-year check and no audit detail.
  assert.equal(statements, 6);
  assert.ok(statements < 50, 'nowhere near the free-plan subrequest cap');
});
