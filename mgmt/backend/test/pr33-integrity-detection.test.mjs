// audit Wave 4 / PR-33 — data-integrity DETECTION (read-only).
//
// What these tests are really pinning:
//
// 1. Every check FINDS the thing it claims to find. Each duplicate/orphan case is
//    planted into the COMMITTED schema (mgmt/db/schema/*.sql — not a fixture schema
//    invented here), which incidentally demonstrates the finding itself: the insert
//    SUCCEEDS. That is the audit's point. `login_users.name`, `users.id_code`,
//    `loans.loan_id`, consent ids and tokens and `(collections.year, sl_no)` are all
//    ordinary indexes, so the database accepts every duplicate below without
//    complaint, and until now nothing anywhere reported them.
//
// 2. The report is READ-ONLY. Not "we intended it to be" — every statement issued
//    against every binding is captured and asserted to be a SELECT. A detection tool
//    that can write is a repair tool nobody reviewed, and this one runs against nine
//    live databases.
//
// 3. A check that could not run is NEVER reported as clean. An unconfigured binding
//    or a throwing query produces `unavailable`/`error` and forces `ok: false`. The
//    dangerous failure mode for a report like this is a false clean bill of health.
//
// Run: node --test mgmt/backend/test/pr33-integrity-detection.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import {
  runIntegrityReport,
  parseFileRecordId,
  checkIds,
  SAMPLE_LIMIT,
} from '../src/integrity.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };

// Records every statement sent to a binding so the read-only claim can be asserted
// rather than trusted.
function spy(d1, log, label) {
  return {
    ...d1,
    prepare(sql) {
      log.push({ binding: label, sql });
      return d1.prepare(sql);
    },
  };
}

// A full four-database env on the committed schema. `log` collects every statement.
function makeEnv(log = []) {
  const env = {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
  };
  const raw = { ...env };
  for (const k of Object.keys(env)) env[k] = spy(env[k], log, k);
  env._raw = raw; // unspied handles, for planting fixtures
  return env;
}

function exec(env, binding, sql) {
  env._raw[binding]._db.exec(sql);
}

function byId(report, id) {
  const c = report.checks.find(x => x.id === id);
  assert.ok(c, `check ${id} missing from the report`);
  return c;
}

// ---------------------------------------------------------------------------

describe('the report runs read-only and reports honestly', () => {
  test('every statement issued against every database is a SELECT', async () => {
    const log = [];
    const env = makeEnv(log);
    // Plant a violation of every kind, so the run takes its LONGEST path — the
    // branches that build samples and follow up on missing references. A read-only
    // assertion on the empty path would prove very little.
    plantEverything(env);

    await runIntegrityReport(env, SUPER);

    assert.ok(log.length > 0, 'the report issued no statements at all');
    const writes = log.filter(e => !/^\s*SELECT\b/i.test(e.sql));
    assert.deepEqual(
      writes.map(w => `${w.binding}: ${w.sql.slice(0, 60)}`),
      [],
      'the integrity report must only ever SELECT'
    );
  });

  test('a clean database reports ok, with every check accounted for', async () => {
    const env = makeEnv();
    const report = await runIntegrityReport(env, SUPER);

    assert.equal(report.ok, true);
    assert.equal(report.summary.checksNotRun, 0);
    assert.equal(report.summary.checksWithFindings, 0);
    assert.equal(report.summary.totalFindings, 0);
    // No check may go missing from the output — a report is only as trustworthy as
    // its completeness.
    assert.deepEqual(report.checks.map(c => c.id), checkIds());
    for (const c of report.checks) assert.equal(c.status, 'clean', `${c.id} was not clean`);
  });

  test('an unconfigured database is reported as unavailable, NOT as clean', async () => {
    const env = makeEnv();
    delete env.DB_LOANS_EXPENSES; // e.g. a binding missing from wrangler.toml

    const report = await runIntegrityReport(env, SUPER);

    const c = byId(report, 'dup_loan_id');
    assert.equal(c.status, 'unavailable');
    assert.match(c.reason, /DB_LOANS_EXPENSES/);
    // The whole report must refuse to say "ok" while a check could not run.
    assert.equal(report.ok, false);
    assert.ok(report.summary.notRun.includes('dup_loan_id'));
    assert.ok(report.summary.checksNotRun > 0);
  });

  test('a check whose query throws is surfaced, not swallowed into clean', async () => {
    const env = makeEnv();
    // A table the check needs has been dropped out from under it.
    exec(env, 'DB_CORE', 'DROP TABLE login_users;');

    const report = await runIntegrityReport(env, SUPER);

    const c = byId(report, 'dup_login_name');
    assert.equal(c.status, 'error');
    assert.match(c.reason, /login_users/);
    assert.equal(report.ok, false);
    // The other core check still ran — one broken check does not abort the report.
    assert.equal(byId(report, 'dup_user_id_code').status, 'clean');
  });

  test('only a Superadmin may run it', async () => {
    const env = makeEnv();
    for (const role of ['Admin', 'Subadmin', 'Viewer', undefined]) {
      await assert.rejects(
        () => runIntegrityReport(env, { name: 'x', role }),
        /Only a Superadmin/,
        `role ${role} should not be able to run the integrity report`
      );
    }
  });

  test('a run can be narrowed, and an unknown check id is rejected', async () => {
    const env = makeEnv();

    const one = await runIntegrityReport(env, SUPER, { only: ['dup_loan_id'] });
    assert.deepEqual(one.checks.map(c => c.id), ['dup_loan_id']);

    await assert.rejects(
      () => runIntegrityReport(env, SUPER, { only: ['dup_loan_id', 'nope'] }),
      /Unknown integrity check: nope/
    );
  });

  test('each finding carries the SQL that produced it', async () => {
    const env = makeEnv();
    exec(env, 'DB_LOANS_EXPENSES', `
      INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-1', 'USER0001');
      INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-1', 'USER0002');
    `);
    const c = byId(await runIntegrityReport(env, SUPER), 'dup_loan_id');
    // The row caps mean an operator sometimes needs to re-run a query by hand for an
    // exact count; the report has to hand them the query to do it with.
    assert.match(c.sql, /^SELECT .*FROM loans .*GROUP BY loan_id/i);
  });
});

describe('duplicates on keys the code assumes are unique', () => {
  test('two logins with one name — and the roles they resolve to', async () => {
    const env = makeEnv();
    // The committed schema ACCEPTS this. That is the finding.
    exec(env, 'DB_CORE', `
      INSERT INTO login_users (name, password, role) VALUES ('ashutosh', 'a', 'Superadmin');
      INSERT INTO login_users (name, password, role) VALUES ('ashutosh', 'b', 'Subadmin');
      INSERT INTO login_users (name, password, role) VALUES ('someone',  'c', 'Admin');
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'dup_login_name');

    assert.equal(c.status, 'findings');
    assert.equal(c.found, 1);
    assert.equal(c.samples[0].name, 'ashutosh');
    assert.equal(c.samples[0].copies, 2);
    // Why the roles are reported: auth.js resolves a login, and re-checks the role on
    // every authenticated request, with `WHERE name = ? LIMIT 1`. Two rows means the
    // role that request runs with is whichever one D1 hands back — so a duplicate
    // spanning Superadmin and Subadmin is a privilege question.
    const roles = c.samples[0].roles.split(',').sort();
    assert.deepEqual(roles, ['Subadmin', 'Superadmin']);
  });

  test('duplicate names are matched the way login matches them (case-insensitively)', async () => {
    const env = makeEnv();
    exec(env, 'DB_CORE', `
      INSERT INTO login_users (name, password, role) VALUES ('Ashutosh', 'a', 'Superadmin');
      INSERT INTO login_users (name, password, role) VALUES ('ashutosh', 'b', 'Subadmin');
    `);
    // A check that grouped case-SENSITIVELY would call this pair clean while the
    // login path (which uses COLLATE NOCASE) treats them as the same account.
    const c = byId(await runIntegrityReport(env, SUPER), 'dup_login_name');
    assert.equal(c.found, 1);
  });

  test('two member rows with one USER#### id (blocks migration 07)', async () => {
    const env = makeEnv();
    exec(env, 'DB_CORE', `
      INSERT INTO users (id_code, name, village) VALUES ('USER0007', 'Ajay Verma', 'Gardih');
      INSERT INTO users (id_code, name, village) VALUES ('USER0007', 'Vijay Kumar', 'Shaharpura');
      INSERT INTO users (id_code, name, village) VALUES ('',         'Blank Code', 'Gardih');
      INSERT INTO users (id_code, name, village) VALUES (NULL,       'Null Code',  'Gardih');
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'dup_user_id_code');

    assert.equal(c.found, 1);
    assert.equal(c.samples[0].id_code, 'USER0007');
    assert.equal(c.samples[0].copies, 2);
    // NULL and '' are exempt everywhere — the enforcing index in migration 07 is
    // PARTIAL for the same reason, so a detector that flagged blanks would report
    // rows the constraint will never reject.
    assert.ok(!c.samples.some(s => !s.id_code));
  });

  test('the same person entered twice is reported for REVIEW, not as a defect', async () => {
    const env = makeEnv();
    // The live report behind C15/C16: two `Ajay Verma`. Village told those two apart.
    // These two share the village as well, so nothing in the UI can.
    exec(env, 'DB_CORE', `
      INSERT INTO users (id_code, name, fathers_name, village) VALUES ('USER0010', 'Ajay Verma',  'Ram Verma',  'Gardih');
      INSERT INTO users (id_code, name, fathers_name, village) VALUES ('USER0011', ' ajay verma ', 'RAM VERMA', 'gardih');
      INSERT INTO users (id_code, name, fathers_name, village) VALUES ('USER0012', 'Ajay Verma',  'Shyam Verma', 'Gardih');
    `);

    const report = await runIntegrityReport(env, SUPER);
    const c = byId(report, 'dup_person');

    // Normalised on case and surrounding space, or the pair above would be missed.
    assert.equal(c.found, 1);
    assert.equal(c.samples[0].copies, 2);
    assert.deepEqual(c.samples[0].id_codes.split(',').sort(), ['USER0010', 'USER0011']);
    // A different father's name is a different person — USER0012 is not reported.
    assert.ok(!c.samples[0].id_codes.includes('USER0012'));

    // THE IMPORTANT ASSERTION. Two people genuinely can share all three fields, so
    // this is a list for a human, not a violated invariant. It must not be counted
    // as blocking, and PR-34 must not turn it into a unique index.
    assert.equal(c.severity, 'review');
    assert.deepEqual(report.summary.blocking, []);
    assert.deepEqual(report.summary.needsReview, ['dup_person']);
    assert.equal(report.ok, true);
  });

  test('two contributions printing one receipt number', async () => {
    const env = makeEnv();
    exec(env, 'DB_COLLECTIONS', `
      INSERT INTO collections (year, sl_no, name, amount) VALUES (2026, 45, 'USER0001', 500);
      INSERT INTO collections (year, sl_no, name, amount) VALUES (2026, 45, 'USER0002', 1100);
      INSERT INTO collections (year, sl_no, name, amount) VALUES (2026, 46, 'USER0003', 200);
      INSERT INTO collections (year, sl_no, name, amount) VALUES (2025, 45, 'USER0004', 300);
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'dup_collection_sl_no');

    assert.equal(c.found, 1);
    assert.equal(c.samples[0].copies, 2);
    // The receipt number is not a stored column: templates.js builds it as
    // `NCS-<year>-<Sl. No.>`. So the collision an operator has to reason about is
    // this string, and the report gives it to them rather than making them derive it.
    assert.equal(c.samples[0].receipt_no, 'NCS-2026-45');
    // (2026,46) and (2025,45) are distinct pairs and must not be swept in.
    assert.equal(c.found, 1);
  });

  test('two loans with one Loan ID', async () => {
    const env = makeEnv();
    exec(env, 'DB_LOANS_EXPENSES', `
      INSERT INTO loans (year, loan_id, name, amount) VALUES (2026, 'LN-2026-1', 'USER0001', 5000);
      INSERT INTO loans (year, loan_id, name, amount) VALUES (2026, 'LN-2026-1', 'USER0002', 7000);
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'dup_loan_id');
    assert.equal(c.found, 1);
    assert.equal(c.samples[0].loan_id, 'LN-2026-1');
  });

  test('two consents with one consent id', async () => {
    const env = makeEnv();
    exec(env, 'DB_LOANS_EXPENSES', `
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, status) VALUES ('CN7', 'LN-1', 'USER0001', 'loaner',    'accepted');
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, status) VALUES ('CN7', 'LN-2', 'USER0002', 'guarantor', 'pending');
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'dup_consent_id');
    assert.equal(c.found, 1);
    assert.equal(c.samples[0].consent_id, 'CN7');
    // Both loans are named so the operator can see which two records collide — the
    // consent PDF for one would overwrite the other's row in generated_files, which
    // DOES have a unique index.
    assert.deepEqual(c.samples[0].loan_ids.split(',').sort(), ['LN-1', 'LN-2']);
  });

  test('one consent link that opens two consents, and whether either is still live', async () => {
    const env = makeEnv();
    exec(env, 'DB_LOANS_EXPENSES', `
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES ('CN1', 'LN-1', 'USER0001', 'loaner',    'tok-shared', 'pending');
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES ('CN2', 'LN-2', 'USER0002', 'guarantor', 'tok-shared', 'accepted');
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES ('CN3', 'LN-3', 'USER0003', 'loaner',    'tok-unique', 'pending');
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'dup_consent_token');

    assert.equal(c.found, 1);
    assert.equal(c.samples[0].copies, 2);
    // The token is the entire authorization on the public consent page. A shared one
    // on a row that is still 'pending' is a live credential, not history — which is
    // why the statuses come back with it.
    assert.ok(c.samples[0].statuses.includes('pending'));
    assert.deepEqual(c.samples[0].person_ids.split(',').sort(), ['USER0001', 'USER0002']);
  });

  test('findings are capped and the cap is declared', async () => {
    const env = makeEnv();
    const rows = [];
    for (let i = 0; i < SAMPLE_LIMIT + 5; i++) {
      rows.push(`INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-${i}', 'U1');`);
      rows.push(`INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-${i}', 'U2');`);
    }
    exec(env, 'DB_LOANS_EXPENSES', rows.join('\n'));

    const c = byId(await runIntegrityReport(env, SUPER), 'dup_loan_id');

    assert.equal(c.samples.length, SAMPLE_LIMIT);
    assert.equal(c.truncated, true);
    // An operator must be able to tell "50 problems" from "at least 50 problems".
    assert.equal(c.found, SAMPLE_LIMIT);
  });
});

describe('orphans inside one database', () => {
  test('consents left behind by a deleted loan, and whether their link still works', async () => {
    const env = makeEnv();
    exec(env, 'DB_LOANS_EXPENSES', `
      INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-ALIVE', 'USER0001');
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES ('CN1', 'LN-ALIVE', 'USER0001', 'loaner', 't1', 'accepted');
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES ('CN2', 'LN-GONE',  'USER0002', 'loaner', 't2', 'pending');
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES ('CN3', '',         'USER0003', 'loaner', 't3', 'pending');
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'orphan_consent_loan');

    assert.equal(c.found, 1);
    assert.equal(c.samples[0].consent_id, 'CN2');
    assert.equal(c.samples[0].loan_id, 'LN-GONE');
    // audit H-8: the loan is gone but the token is not, and this one is still
    // pending — so the link may well still open. `has_token` says so without the
    // report ever putting the token value itself in a response.
    assert.equal(c.samples[0].has_token, 1);
    assert.equal(c.samples[0].status, 'pending');
    assert.ok(!('token' in c.samples[0]), 'the report must not echo consent tokens');
    // An empty loan_id is not an orphan reference — it is no reference.
    assert.ok(!c.samples.some(s => s.consent_id === 'CN3'));
  });

  test('guarantor rows left behind by a deleted loan', async () => {
    const env = makeEnv();
    exec(env, 'DB_LOANS_EXPENSES', `
      INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-ALIVE', 'USER0001');
      INSERT INTO loan_guarantors (year, loan_id, loaner, guarantor) VALUES (2026, 'LN-ALIVE', 'USER0001', 'USER0002');
      INSERT INTO loan_guarantors (year, loan_id, loaner, guarantor) VALUES (2026, 'LN-GONE',  'USER0003', 'USER0004');
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'orphan_guarantor_loan');
    assert.equal(c.found, 1);
    assert.equal(c.samples[0].loan_id, 'LN-GONE');
    // These rows are what make migration 10's PART 2 triggers unsafe to apply today:
    // the trigger would start aborting writes for a loan_id that is already broken.
    assert.match(c.hint, /migration 10/);
  });
});

describe('orphans that span databases (no SQL file can express these)', () => {
  test('rows naming a member who is not in the members table', async () => {
    const env = makeEnv();
    exec(env, 'DB_CORE', `
      INSERT INTO users (id_code, name, village) VALUES ('USER0001', 'Real Person', 'Gardih');
      INSERT INTO committee_members (year, name) VALUES (2026, 'USER0001');
      INSERT INTO committee_members (year, name) VALUES (2026, 'USER9999');
    `);
    exec(env, 'DB_COLLECTIONS', `
      INSERT INTO collections (year, sl_no, name, amount) VALUES (2026, 1, 'USER0001', 100);
      INSERT INTO collections (year, sl_no, name, amount) VALUES (2026, 2, 'USER8888', 200);
    `);
    exec(env, 'DB_LOANS_EXPENSES', `
      INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-1', 'USER7777');
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, status) VALUES ('CN1', 'LN-1', 'USER6666', 'loaner', 'pending');
      INSERT INTO loan_guarantors (year, loan_id, loaner, guarantor) VALUES (2026, 'LN-1', 'USER0001', 'USER5555');
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'orphan_person_ref');

    assert.equal(c.status, 'findings');
    const missing = c.samples.map(s => s.missing_id_code).sort();
    assert.deepEqual(missing, ['USER5555', 'USER6666', 'USER7777', 'USER8888', 'USER9999']);
    // Each finding has to say WHERE the dangling id is and what it was meant to be,
    // because "USER8888 does not exist" is not actionable on its own.
    const collection = c.samples.find(s => s.missing_id_code === 'USER8888');
    assert.equal(collection.table, 'collections');
    assert.equal(collection.column, 'name');
    assert.equal(collection.means, 'the contributor');
    const guarantor = c.samples.find(s => s.missing_id_code === 'USER5555');
    assert.equal(guarantor.table, 'loan_guarantors');
    assert.equal(guarantor.column, 'guarantor');
    // USER0001 exists and is referenced from three places; it must not appear.
    assert.ok(!missing.includes('USER0001'));
  });

  test('generated documents filed against a row that no longer exists', async () => {
    const env = makeEnv();
    exec(env, 'DB_COLLECTIONS', `
      INSERT INTO collections (id, year, sl_no, name, amount) VALUES (11, 2026, 1, 'USER0001', 100);
    `);
    exec(env, 'DB_LOANS_EXPENSES', `
      INSERT INTO loan_consents (consent_id, loan_id, person_id, role, status) VALUES ('CN1', 'LN-1', 'USER0001', 'loaner', 'accepted');
    `);
    exec(env, 'DB_FILE_INDEX', `
      INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link) VALUES ('receipt',        2026, 'receipt-2026-11',        'a.pdf', 'x');
      INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link) VALUES ('receipt',        2026, 'receipt-2026-99',        'b.pdf', 'x');
      INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link) VALUES ('consent_loaner', 2026, 'consent_loaner-2026-CN1','c.pdf', 'x');
      INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link) VALUES ('consent_loaner', 2026, 'consent_loaner-2026-CNX','d.pdf', 'x');
      INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link) VALUES ('report_both',    2026, 'report_both-2026',       'e.pdf', 'x');
    `);

    const c = byId(await runIntegrityReport(env, SUPER), 'orphan_generated_file');

    assert.equal(c.found, 2);
    const ids = c.samples.map(s => s.record_id).sort();
    assert.deepEqual(ids, ['consent_loaner-2026-CNX', 'receipt-2026-99']);
    // The reference is a composite string built in ANOTHER database, so the report
    // has to translate it back into the row it was looking for.
    assert.equal(c.samples.find(s => s.record_id === 'receipt-2026-99').missing, 'collections.id = 99');
    assert.equal(
      c.samples.find(s => s.record_id === 'consent_loaner-2026-CNX').missing,
      'loan_consents.consent_id = CNX'
    );
    // A yearly report is ONE document per year and refers to no row at all. Counting
    // it as an orphan would bury the two real findings in false positives.
    assert.ok(!ids.includes('report_both-2026'));
  });

  test('record_id shapes are classified the way docxTemplates.js writes them', () => {
    // Per-row documents: `<docType>-<year>-<ref>`.
    assert.deepEqual(parseFileRecordId('receipt', 2026, 'receipt-2026-45').ref, '45');
    assert.equal(parseFileRecordId('receipt', 2026, 'receipt-2026-45').table, 'collections');
    assert.equal(parseFileRecordId('samaan', 2026, 'samaan-2026-7').column, 'id');
    assert.equal(
      parseFileRecordId('consent_guarantor', 2026, 'consent_guarantor-2026-CN9').table,
      'loan_consents'
    );

    // Per-year reports carry no reference — never an orphan.
    assert.equal(parseFileRecordId('report_both', 2026, 'report_both-2026'), null);
    // A doc type this module does not model is skipped rather than guessed at.
    assert.equal(parseFileRecordId('something_new', 2026, 'something_new-2026-1'), null);
    // A collections reference must be a row id; anything else is not something we can
    // look up, so it is not reported as missing.
    assert.equal(parseFileRecordId('receipt', 2026, 'receipt-2026-abc'), null);
    // A mismatched year is not this year's reference.
    assert.equal(parseFileRecordId('receipt', 2026, 'receipt-2025-45'), null);
  });
});

// Plants one instance of every finding, for the read-only test's long path.
function plantEverything(env) {
  exec(env, 'DB_CORE', `
    INSERT INTO login_users (name, password, role) VALUES ('dup', 'a', 'Superadmin');
    INSERT INTO login_users (name, password, role) VALUES ('dup', 'b', 'Subadmin');
    INSERT INTO users (id_code, name, fathers_name, village) VALUES ('USER0007', 'A B', 'C D', 'V');
    INSERT INTO users (id_code, name, fathers_name, village) VALUES ('USER0007', 'A B', 'C D', 'V');
    INSERT INTO committee_members (year, name) VALUES (2026, 'USER9999');
  `);
  exec(env, 'DB_COLLECTIONS', `
    INSERT INTO collections (year, sl_no, name, amount) VALUES (2026, 45, 'USER8888', 100);
    INSERT INTO collections (year, sl_no, name, amount) VALUES (2026, 45, 'USER8888', 200);
  `);
  exec(env, 'DB_LOANS_EXPENSES', `
    INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-1', 'USER7777');
    INSERT INTO loans (year, loan_id, name) VALUES (2026, 'LN-1', 'USER7777');
    INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES ('CN1', 'LN-GONE', 'USER6666', 'loaner', 'tok', 'pending');
    INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status) VALUES ('CN1', 'LN-GONE', 'USER6666', 'loaner', 'tok', 'pending');
    INSERT INTO loan_guarantors (year, loan_id, loaner, guarantor) VALUES (2026, 'LN-GONE', 'USER5555', 'USER4444');
  `);
  exec(env, 'DB_FILE_INDEX', `
    INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link) VALUES ('receipt', 2026, 'receipt-2026-99', 'a.pdf', 'x');
  `);
}
