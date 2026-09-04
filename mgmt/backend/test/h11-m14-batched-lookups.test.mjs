// ===== AUDIT H-11 (N+1 loops) + M-14 (full-table scans in the consent flow) =====
//
// WHY THIS IS A CORRECTNESS ISSUE ON THE FREE TIER, NOT JUST PERFORMANCE:
//   * D1 allows 5,000,000 row reads per DAY across all nine databases, and the consent
//     flow contained TEN `getSheetDataAsJSON(env,'USERS')` calls plus six `…'LOANS'`
//     calls — each one reading a whole table to look up two or three ids.
//   * EVERY D1 query counts as a SUBREQUEST, and the free plan caps ONE Worker
//     invocation at 50 (not the 1000 available on paid). getUserProfile ran three
//     sequential `for … await` loops, so a member who had guaranteed ten loans issued
//     ~35 subrequests — meaning a slightly busier record did not get slow, it FAILED.
//
// The decisive property asserted here is therefore not "it is faster" but
// "the number of queries does NOT grow with the number of related records".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { getUserProfile } from '../src/views.js';
import { getPersonDownloads } from '../src/docxTemplates.js';
import { getConsentByToken, getLoanConsents, getConsentsForReview } from '../src/loans.js';
import { usersByIdCodes, loansByLoanIds, generatedFilesByRecordIds } from '../src/lookups.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

// Wraps every D1 binding on `env` so we can count queries and inspect the SQL.
function instrument(env) {
  const log = [];
  for (const [name, db] of Object.entries(env)) {
    if (!db || typeof db.prepare !== 'function') continue;
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      log.push({ binding: name, sql: sql.replace(/\s+/g, ' ').trim() });
      return realPrepare(sql);
    };
  }
  return {
    count: () => log.length,
    all: () => log,
    reset: () => { log.length = 0; },
    fullScans: () => log.filter(e => /^SELECT \* FROM \w+ ORDER BY id ASC$/i.test(e.sql)),
  };
}

// ---------------------------------------------------------------- FIXTURES

function baseEnv() {
  return {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    KV_SESSIONS: makeKV(),
  };
}

// A realistically-sized member table, so a scan is clearly distinguishable.
function seedMembers(env, n = 3000) {
  const ins = env.DB_CORE.prepare(
    'INSERT INTO users (id_code, name, village, fathers_name, mobile, designation) VALUES (?,?,?,?,?,?)');
  for (let i = 1; i <= n; i++) {
    ins.bind(`USER${String(i).padStart(4, '0')}`, `Member ${i}`, 'Shaharpura', `Father ${i}`, 9000000000 + i, 'Member').run();
  }
}

// Gives USER0001 `guarantees` guarantor rows, each on a DIFFERENT loan by a
// different loaner — the exact shape that made getUserProfile's loops explode.
function seedGuarantees(env, guarantees) {
  for (let i = 1; i <= guarantees; i++) {
    const loanId = `LN${i}`;
    // Loaner ids must fall inside the seeded member range, so their display names
    // really do have to be resolved (USER0001 is the subject, so start at 2).
    const loanerId = `USER${String(i + 1).padStart(4, '0')}`;
    env.DB_LOANS_EXPENSES.prepare(
      'INSERT INTO loans (year, name, amount, intrest_rate, tenure, loan_id, status) VALUES (?,?,?,?,?,?,?)')
      .bind(2026, loanerId, 10000 + i, 2, 12, loanId, 'Active').run();
    env.DB_LOANS_EXPENSES.prepare(
      'INSERT INTO loan_guarantors (year, loaner, guarantor, loan_id) VALUES (?,?,?,?)')
      .bind(2026, loanerId, 'USER0001', loanId).run();
  }
}

// ------------------------------------------------------- H-11 getUserProfile

test('H-11: getUserProfile query count does NOT grow with the number of guarantees', async () => {
  const counts = {};
  for (const guarantees of [1, 5, 20]) {
    const env = baseEnv();
    seedMembers(env, 500);
    seedGuarantees(env, guarantees);
    const spy = instrument(env);
    const profile = await getUserProfile(env, 'USER0001');
    counts[guarantees] = spy.count();
    assert.equal(profile.guarantorFor.length, guarantees, 'all guarantees must still be reported');
  }
  // The old implementation issued roughly 3 queries PER guarantee.
  assert.equal(counts[1], counts[20],
    `query count grew with the data: 1 guarantee = ${counts[1]}, 20 = ${counts[20]}`);
  assert.equal(counts[5], counts[20]);
  // And it must stay far below the free plan's 50-subrequest ceiling.
  assert.ok(counts[20] <= 10, `expected a small constant, got ${counts[20]} queries`);
});

test('H-11: getUserProfile never reads a whole table', async () => {
  const env = baseEnv();
  seedMembers(env, 3000);
  seedGuarantees(env, 10);
  const spy = instrument(env);
  await getUserProfile(env, 'USER0001');
  assert.deepEqual(spy.fullScans().map(e => e.sql), [],
    'no `SELECT * FROM x ORDER BY id ASC` may appear');
  // Every read must be scoped by an equality or an IN list.
  for (const { sql } of spy.all()) {
    assert.match(sql, / WHERE /i, `unscoped query: ${sql}`);
  }
});

test('H-11 regression guard: getUserProfile output is unchanged', async () => {
  const env = baseEnv();
  seedMembers(env, 100);
  seedGuarantees(env, 2);
  // Contributions + a loan of the person's own.
  env.DB_COLLECTIONS.prepare(
    'INSERT INTO collections (year, sl_no, name, amount, payment_mode) VALUES (?,?,?,?,?)')
    .bind(2026, 1, 'USER0001', 500, 'Cash').run();
  env.DB_COLLECTIONS.prepare(
    'INSERT INTO collections (year, sl_no, name, amount, payment_mode) VALUES (?,?,?,?,?)')
    .bind(2025, 1, 'USER0001', 300, 'UPI').run();
  env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loans (year, name, amount, intrest_rate, tenure, loan_id, status) VALUES (?,?,?,?,?,?,?)')
    .bind(2024, 'USER0001', 25000, 2, 6, 'LN-OWN', 'Repaid').run();
  env.DB_CORE.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
    .bind(2026, 'USER0001', 'Treasurer').run();

  const p = await getUserProfile(env, 'USER0001');

  assert.equal(p.user.ID, 'USER0001');
  assert.equal(p.user.Name, 'Member 1');
  // Contributions: newest first, summed.
  assert.deepEqual(p.contributions.map(c => [c.Year, c.Amount]), [[2026, 500], [2025, 300]]);
  assert.equal(p.totalContributed, 800);
  // Own loans.
  assert.equal(p.loansTaken.length, 1);
  assert.deepEqual(
    [p.loansTaken[0].Year, p.loansTaken[0].Amount, p.loansTaken[0].Status],
    [2024, 25000, 'Repaid']);
  // Guarantees resolve the loaner's DISPLAY NAME and the loan's amount/status — the
  // three things the old N+1 loops existed to fetch.
  assert.equal(p.guarantorFor.length, 2);
  for (const g of p.guarantorFor) {
    assert.equal(g.Year, 2026);
    assert.match(g.LoanerName, /^Member \d+$/, `loaner name must resolve, got ${g.LoanerName}`);
    assert.ok(g.Amount > 10000, 'the referenced loan amount must resolve');
    assert.equal(g.Status, 'Active');
  }
  assert.deepEqual(p.committeeYears, [{ Year: 2026, 'View Role': 'Treasurer' }]);
});

test('H-11: a LEGACY guarantor row with no Loan ID still resolves its loan', async () => {
  // Those rows are matched on Year + Loaner, which is why one of the three original
  // loops fetched "the loaner's loans by name". The batched version must keep that.
  const env = baseEnv();
  seedMembers(env, 50);
  env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loans (year, name, amount, intrest_rate, tenure, loan_id, status) VALUES (?,?,?,?,?,?,?)')
    .bind(2026, 'USER0007', 77000, 2, 12, '', 'Active').run();
  env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loan_guarantors (year, loaner, guarantor, loan_id) VALUES (?,?,?,?)')
    .bind(2026, 'USER0007', 'USER0001', '').run();

  const p = await getUserProfile(env, 'USER0001');
  assert.equal(p.guarantorFor.length, 1);
  assert.equal(p.guarantorFor[0].Amount, 77000, 'the legacy Year+Loaner match must still work');
  assert.equal(p.guarantorFor[0].LoanerName, 'Member 7');
});

// -------------------------------------------------- H-11 getPersonDownloads

test('H-11: getPersonDownloads query count does NOT grow with the document count', async () => {
  const counts = {};
  for (const docs of [1, 10, 40]) {
    const env = baseEnv();
    seedMembers(env, 200);
    for (let i = 1; i <= docs; i++) {
      env.DB_COLLECTIONS.prepare(
        'INSERT INTO collections (year, sl_no, name, amount, contribution_type, is_resell) VALUES (?,?,?,?,?,?)')
        .bind(2000 + i, i, 'USER0001', 100 * i, 1, 'FALSE').run();
    }
    const spy = instrument(env);
    const res = await getPersonDownloads(env, 'USER0001', SUPERADMIN);
    counts[docs] = spy.count();
    assert.equal(res.collections.length, docs, 'every document must still be listed');
  }
  // The old code called isFileGenerated() once per row.
  assert.equal(counts[1], counts[40],
    `query count grew with the data: 1 doc = ${counts[1]}, 40 = ${counts[40]}`);
  assert.ok(counts[40] <= 10, `expected a small constant, got ${counts[40]}`);
});

test('H-11: getPersonDownloads still reports which documents exist', async () => {
  const env = baseEnv();
  seedMembers(env, 50);
  env.DB_COLLECTIONS.prepare(
    'INSERT INTO collections (year, sl_no, name, amount, contribution_type, is_resell) VALUES (?,?,?,?,?,?)')
    .bind(2026, 1, 'USER0001', 500, 1, 'FALSE').run();
  env.DB_COLLECTIONS.prepare(
    'INSERT INTO collections (year, sl_no, name, amount, contribution_type, is_resell) VALUES (?,?,?,?,?,?)')
    .bind(2025, 1, 'USER0001', 300, 1, 'FALSE').run();
  // Only the 2026 one has been generated.
  const rows = await env.DB_COLLECTIONS.prepare('SELECT id, year FROM collections ORDER BY year DESC').all();
  const newest = rows.results[0];
  env.DB_FILE_INDEX.prepare(
    'INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link) VALUES (?,?,?,?,?)')
    .bind('receipt', 2026, `receipt-2026-${newest.id}`, 'r.pdf', 'https://files/r.pdf').run();

  const res = await getPersonDownloads(env, 'USER0001', SUPERADMIN);
  const byYear = Object.fromEntries(res.collections.map(c => [c.year, c]));
  assert.equal(byYear[2026].publicLink, 'https://files/r.pdf', 'a generated document must expose its link');
  assert.equal(byYear[2025].publicLink, null, 'an ungenerated one must report null, not undefined');
  // Placeholders must still be complete.
  assert.equal(byYear[2026].placeholders.NAME, 'Member 1');
  assert.equal(byYear[2026].placeholders.RECEIPT_NO, 'NCS-2026-1');
});

// -------------------------------------------------- M-14 the consent flow

test('M-14: getConsentByToken (PUBLIC) no longer scans users or loans', async () => {
  const env = baseEnv();
  seedMembers(env, 3000);
  env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loans (year, name, amount, intrest_rate, tenure, loan_id, loan_status) VALUES (?,?,?,?,?,?,?)')
    .bind(2026, 'USER0002', 50000, 2, 12, 'LN1', 'Created').run();
  const token = 'c'.repeat(64);
  env.DB_LOANS_EXPENSES.prepare(
    `INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, otp, otp_verified, send_count, created_at, responded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind('CN1', 'LN1', 'USER0003', 'guarantor', token, 'pending', '', 0, 1, '2026-09-01', '').run();
  env.DB_TEMPLATES.prepare('INSERT INTO consent_page_templates (type, text, updated_at) VALUES (?,?,?)')
    .bind('guarantor_consent', 'Hello [GUARANTOR_NAME]', '2026-01-01').run();

  const spy = instrument(env);
  const res = await getConsentByToken(env, token);

  assert.equal(res.status, 'pending');
  assert.equal(res.role, 'guarantor');
  assert.match(res.templateText, /GUARANTOR_NAME/);
  assert.equal(res.placeholders.GUARANTOR_NAME, 'Member 3', 'the person name must still resolve');
  assert.equal(res.placeholders.LOANER_NAME, 'Member 2');

  assert.deepEqual(spy.fullScans().map(e => e.sql), [], 'no full-table read is allowed on a public endpoint');
  assert.ok(spy.count() <= 12, `expected a small bounded query count, got ${spy.count()}`);
});

test('M-14: getLoanConsents and getConsentsForReview scale with the PAGE, not the table', async () => {
  const env = baseEnv();
  seedMembers(env, 2000);
  env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loans (year, name, amount, loan_id) VALUES (?,?,?,?)').bind(2026, 'USER0002', 50000, 'LN1').run();
  for (let i = 1; i <= 25; i++) {
    env.DB_LOANS_EXPENSES.prepare(
      `INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, responded_at)
       VALUES (?,?,?,?,?,?,?)`)
      .bind(`CN${i}`, 'LN1', `USER${String(i).padStart(4, '0')}`, 'guarantor', `t${i}`, 'accepted', `2026-09-${String(i).padStart(2, '0')}`).run();
  }

  let spy = instrument(env);
  const list = await getLoanConsents(env, 'LN1', SUPERADMIN);
  assert.equal(list.length, 25);
  assert.equal(list[0].personName, 'Member 1', 'names still resolve');
  assert.deepEqual(spy.fullScans().map(e => e.sql), []);
  assert.ok(spy.count() <= 4, `getLoanConsents used ${spy.count()} queries`);

  spy = instrument(env);
  const review = await getConsentsForReview(env, SUPERADMIN);
  assert.equal(review.length, 25);
  assert.equal(review[0].loanerName, 'Member 2', 'the loaner name still resolves');
  assert.equal(review[0].loanAmount, 50000);
  assert.deepEqual(spy.fullScans().map(e => e.sql), []);
  assert.ok(spy.count() <= 5, `getConsentsForReview used ${spy.count()} queries`);
});

// ------------------------------------------------------------ lookups.js

test('H-11: IN (...) lists are CHUNKED so a big id set cannot blow D1\'s parameter limit', async () => {
  const env = baseEnv();
  seedMembers(env, 500);
  const ids = Array.from({ length: 250 }, (_, i) => `USER${String(i + 1).padStart(4, '0')}`);
  const spy = instrument(env);
  const map = await usersByIdCodes(env, ids);
  assert.equal(Object.keys(map).length, 250, 'every requested member must come back');
  // 250 ids / 90 per chunk = 3 queries. Never 250, and never 1 giant statement.
  assert.equal(spy.count(), 3, `expected 3 chunked queries, got ${spy.count()}`);
  for (const { sql } of spy.all()) {
    const params = (sql.match(/\?/g) || []).length;
    assert.ok(params <= 90, `a statement bound ${params} parameters — over the safe chunk size`);
  }
});

test('H-11: the lookup helpers de-duplicate, skip blanks, and tolerate empty input', async () => {
  const env = baseEnv();
  seedMembers(env, 20);
  const spy = instrument(env);
  const map = await usersByIdCodes(env, ['USER0001', 'USER0001', ' USER0001 ', '', null, undefined, 'USER0002']);
  assert.deepEqual(Object.keys(map).sort(), ['USER0001', 'USER0002']);
  assert.equal(spy.count(), 1, 'duplicates and blanks must collapse into ONE query');

  // Empty input must not issue a query at all, and must not throw.
  spy.reset();
  assert.deepEqual(await usersByIdCodes(env, []), {});
  assert.deepEqual(await usersByIdCodes(env, [null, '', '  ']), {});
  assert.deepEqual(await loansByLoanIds(env, []), {});
  assert.deepEqual(await generatedFilesByRecordIds(env, []), {});
  assert.equal(spy.count(), 0, 'no query may be issued for an empty id set');

  // A missing binding must degrade quietly, as every other lookup here does.
  assert.deepEqual(await usersByIdCodes({}, ['USER0001']), {});
  assert.deepEqual(await usersByIdCodes(null, ['USER0001']), {});
});

test('H-11: a requested id that does not exist is simply absent (callers rely on `|| {}`)', async () => {
  const env = baseEnv();
  seedMembers(env, 5);
  const map = await usersByIdCodes(env, ['USER0001', 'USER9999']);
  assert.ok(map.USER0001, 'the real member is present');
  assert.equal(map.USER9999, undefined, 'the missing one must be absent, not a stub object');
});
