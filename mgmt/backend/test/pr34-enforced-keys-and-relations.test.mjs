// audit PR-34 — the constraints migrations 07/08/10 described but never applied.
//
// All three shipped their real work as SQL COMMENTS, because a UNIQUE index fails
// outright on a table that already holds a duplicate and a trigger starts rejecting
// writes to a row that is already broken. Applying them blind was the risk; nobody
// wanted to take it, so nothing was enforced for months.
//
// PR-33's report removed that risk by measuring: against the live databases, every
// precondition came back 0. So these migrations become executable, and this file
// proves what they then do.
//
// The two things worth reading for:
//
//   1. THE UPDATE TRIGGERS. Migration 10's PART 2 is `BEFORE INSERT` only, which the
//      audit flagged: "proposed triggers omit update cases". An insert-only guard is
//      half a guard — it stops a row being created against a missing loan and then
//      lets the same row be re-pointed at a missing loan a moment later. The tests
//      below fail against migration 10's version and pass against this one.
//
//   2. LOAN DELETION STILL WORKS. A `BEFORE DELETE ON loans` guard is the obvious way
//      to prevent the H-8 orphans, and it is deliberately NOT in the migration,
//      because `deleteLoan` sends one D1 batch whose FIRST statement deletes the loan
//      and whose last two delete the children. A delete guard would abort the
//      application's own correct deletion. That is asserted here rather than trusted,
//      by replaying the app's exact statement order.
//
// Run: node --test mgmt/backend/test/pr34-enforced-keys-and-relations.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { schemaFor } from './helpers/stubs.mjs';

const MIGRATION_DIR = new URL('../../db/migration/2026-09-05/', import.meta.url);
const migration = (f) => readFileSync(new URL(f, MIGRATION_DIR), 'utf8');

/** A database on the committed schema with the given migration applied. */
function dbWith(schema, file) {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor(schema));
  db.exec(migration(file));
  return db;
}

const throwsAbort = (fn, re) => assert.throws(fn, (err) => re.test(err.message), `expected an abort matching ${re}`);

describe('34 — users.id_code is unique (H-9)', () => {
  test('a duplicate id_code is refused, and blanks stay exempt', () => {
    const db = dbWith('core.sql', '34-core-unique-id-code.sql');
    const add = (code, name) => db.prepare('INSERT INTO users (id_code, name) VALUES (?, ?)').run(code, name);

    add('USER0007', 'Ajay');
    // The allocation race in crud.js produced exactly this, and nothing noticed
    // because nothing enforced it.
    throwsAbort(() => add('USER0007', 'Vijay'), /UNIQUE|constraint/i);

    // PARTIAL index: legacy rows with a NULL or blank id must still be insertable,
    // many times over, or the constraint would demand a backfill before it could go on.
    add(null, 'Legacy one');
    add(null, 'Legacy two');
    add('', 'Blank one');
    add('', 'Blank two');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 5);
    db.close();
  });

  test('applying it twice is a no-op', () => {
    const db = dbWith('core.sql', '34-core-unique-id-code.sql');
    db.exec(migration('34-core-unique-id-code.sql'));
    db.close();
  });
});

describe('35 — one receipt number, one contribution (M-8)', () => {
  test('a second row with the same (year, sl_no) is refused', () => {
    const db = dbWith('collections.sql', '35-collections-unique-receipt-no.sql');
    const add = (year, sl, name, amt) =>
      db.prepare('INSERT INTO collections (year, sl_no, name, amount) VALUES (?, ?, ?, ?)').run(year, sl, name, amt);

    add(2026, 45, 'USER0001', 500);
    // Two different contributions printing NCS-2026-45 — and colliding in
    // generated_files, whose (doc_type, year, record_id) key IS unique, so one PDF
    // would overwrite the other.
    throwsAbort(() => add(2026, 45, 'USER0002', 1100), /UNIQUE|constraint/i);

    // Neighbours are untouched.
    add(2026, 46, 'USER0003', 200);
    add(2025, 45, 'USER0004', 300);

    // PARTIAL on sl_no: imported rows without a sequence number stay insertable.
    add(2026, null, 'USER0005', 10);
    add(2026, null, 'USER0006', 20);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collections').get().n, 5);
    db.close();
  });

  test('a REAL year still behaves — the live column has not been converted', () => {
    // Migration 12 (REAL -> INTEGER) is a rebuild RECIPE that applies nothing, so the
    // live column still holds 2024.0. The index must work on the values that are
    // actually there, not the ones the committed schema hopes for.
    const db = dbWith('collections.sql', '35-collections-unique-receipt-no.sql');
    db.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?, ?, ?)').run(2024.0, 45, 'USER0001');
    throwsAbort(
      () => db.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?, ?, ?)').run(2024.0, 45, 'USER0002'),
      /UNIQUE|constraint/i
    );
    db.close();
  });
});

describe('36 — the loan relations (M-34, H-8)', () => {
  const setup = () => {
    const db = dbWith('loans_expenses.sql', '36-loans-keys-and-relations.sql');
    db.prepare('INSERT INTO loans (year, loan_id, name, amount) VALUES (?, ?, ?, ?)')
      .run(2026, 'LN-ALIVE', 'USER0001', 5000);
    return db;
  };
  const addConsent = (db, loanId, cid = 'CN1') =>
    db.prepare('INSERT INTO loan_consents (consent_id, loan_id, person_id, role, status) VALUES (?, ?, ?, ?, ?)')
      .run(cid, loanId, 'USER0002', 'loaner', 'pending');
  const addGuarantor = (db, loanId) =>
    db.prepare('INSERT INTO loan_guarantors (year, loan_id, loaner, guarantor) VALUES (?, ?, ?, ?)')
      .run(2026, loanId, 'USER0001', 'USER0003');

  test('a duplicate Loan ID is refused, blanks exempt', () => {
    const db = setup();
    throwsAbort(
      () => db.prepare('INSERT INTO loans (year, loan_id, name) VALUES (?, ?, ?)').run(2026, 'LN-ALIVE', 'USER0009'),
      /UNIQUE|constraint/i
    );
    // Legacy rows saved before loan_id existed.
    db.prepare('INSERT INTO loans (year, loan_id, name) VALUES (?, ?, ?)').run(2019, null, 'USER0009');
    db.prepare('INSERT INTO loans (year, loan_id, name) VALUES (?, ?, ?)').run(2019, '', 'USER0010');
    db.close();
  });

  test('a consent or guarantor naming a missing loan is refused on INSERT', () => {
    const db = setup();
    addConsent(db, 'LN-ALIVE');            // legitimate
    addGuarantor(db, 'LN-ALIVE');          // legitimate
    throwsAbort(() => addConsent(db, 'LN-GONE', 'CN2'), /loan_consents\.loan_id references a loan that does not exist/);
    throwsAbort(() => addGuarantor(db, 'LN-GONE'), /loan_guarantors\.loan_id references a loan that does not exist/);
    db.close();
  });

  test('THE GAP IN MIGRATION 10: re-pointing an existing row is refused too', () => {
    const db = setup();
    addConsent(db, 'LN-ALIVE');
    addGuarantor(db, 'LN-ALIVE');

    // Migration 10's insert-only triggers allow exactly this — create the row
    // legitimately, then move it to a loan that does not exist. Same orphan H-8
    // produced, reached with a different verb.
    throwsAbort(
      () => db.prepare("UPDATE loan_consents SET loan_id = 'LN-GONE' WHERE consent_id = 'CN1'").run(),
      /would be re-pointed at a loan that does not exist/
    );
    throwsAbort(
      () => db.prepare("UPDATE loan_guarantors SET loan_id = 'LN-GONE' WHERE loaner = 'USER0001'").run(),
      /would be re-pointed at a loan that does not exist/
    );

    // Re-pointing at a loan that DOES exist is a legitimate correction and must pass.
    db.prepare('INSERT INTO loans (year, loan_id, name) VALUES (?, ?, ?)').run(2026, 'LN-OTHER', 'USER0004');
    db.prepare("UPDATE loan_consents SET loan_id = 'LN-OTHER' WHERE consent_id = 'CN1'").run();
    assert.equal(db.prepare("SELECT loan_id FROM loan_consents WHERE consent_id = 'CN1'").get().loan_id, 'LN-OTHER');

    // And an update that does not touch loan_id must not be second-guessed.
    db.prepare("UPDATE loan_consents SET status = 'accepted' WHERE consent_id = 'CN1'").run();
    assert.equal(db.prepare("SELECT status FROM loan_consents WHERE consent_id = 'CN1'").get().status, 'accepted');
    db.close();
  });

  test('a blank loan_id is not a broken reference, on insert or update', () => {
    const db = setup();
    addConsent(db, null, 'CN-LEGACY');
    addConsent(db, '', 'CN-BLANK');
    db.prepare("UPDATE loan_consents SET loan_id = '' WHERE consent_id = 'CN-LEGACY'").run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loan_consents').get().n, 2);
    db.close();
  });

  test("the application's own loan deletion still works, in its real statement order", () => {
    // THE POINT OF THIS TEST. deleteLoan (loans.js) builds ONE batch:
    //     [ DELETE FROM loans, DELETE FROM loan_guarantors, DELETE FROM loan_consents ]
    // — parent FIRST. A `BEFORE DELETE ON loans` guard would fire while the children
    // still exist and abort the whole batch, so loan deletion would break. That guard
    // is therefore absent by design, and this replays the real order to prove the
    // migration did not quietly introduce one.
    const db = setup();
    addConsent(db, 'LN-ALIVE');
    addGuarantor(db, 'LN-ALIVE');
    const loanRowId = db.prepare("SELECT id FROM loans WHERE loan_id = 'LN-ALIVE'").get().id;

    db.exec('BEGIN');
    db.prepare('DELETE FROM loans WHERE id = ?').run(loanRowId);
    db.prepare('DELETE FROM loan_guarantors WHERE loan_id = ?').run('LN-ALIVE');
    db.prepare('DELETE FROM loan_consents WHERE loan_id = ?').run('LN-ALIVE');
    db.exec('COMMIT');

    for (const t of ['loans', 'loan_consents', 'loan_guarantors']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} should be empty`);
    }
    db.close();
  });

  test('applying it twice is a no-op', () => {
    const db = dbWith('loans_expenses.sql', '36-loans-keys-and-relations.sql');
    db.exec(migration('36-loans-keys-and-relations.sql'));
    db.close();
  });
});
