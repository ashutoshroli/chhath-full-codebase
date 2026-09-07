// audit M-34 / M-35 — prove the referential-integrity and domain-check migration
// recipes actually work.
//
// The two migration files (2026-09-05/10 and /11) apply NOTHING to live data — they
// ship detection queries + ready-to-run trigger/rebuild recipes as comments, so a
// blind `wrangler d1 execute` is a no-op (verified by the idempotency test in
// h10-m38-indexes-and-retention.test.mjs). This test extracts the PART 2 trigger
// recipes from those files, un-comments them, applies them to the real committed
// schema, and asserts they reject the violations they claim to and allow the writes
// the app legitimately makes. So the recipes are PROVEN, not just documented.
//
// Run: node --test mgmt/backend/test/m34-m35-constraints.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const MIG = join(ROOT, 'mgmt', 'db', 'migration', '2026-09-05');
const SCHEMA = join(ROOT, 'mgmt', 'db', 'schema');

const schemaFor = (f) => readFileSync(join(SCHEMA, f), 'utf8');
const migFor = (f) => readFileSync(join(MIG, f), 'utf8');

// Extract the named CREATE TRIGGER block from a migration file's comments and
// un-comment it (strip the leading "-- " from each line). Returns runnable SQL.
function extractTrigger(fileText, triggerName) {
  const lines = fileText.split('\n');
  const out = [];
  let capturing = false;
  for (const line of lines) {
    const uncommented = line.replace(/^-- ?/, '');
    if (uncommented.includes(`CREATE TRIGGER IF NOT EXISTS ${triggerName}`)) capturing = true;
    if (capturing) {
      out.push(uncommented);
      if (/END;\s*$/.test(uncommented)) break;
    }
  }
  assert.ok(out.length > 0, `trigger ${triggerName} not found in migration file`);
  return out.join('\n');
}

test('M-34: the loan_consents FK trigger recipe rejects orphan consents and allows valid ones', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('loans_expenses.sql'));
  const trig = extractTrigger(migFor('10-loans-referential-integrity.sql'), 'trg_loan_consents_loan_fk_ins');
  db.exec(trig);
  db.exec(trig); // idempotent

  db.exec(`INSERT INTO loans (loan_id, amount) VALUES ('LN-1', 5000);`);
  // valid: consent for an existing loan
  db.exec(`INSERT INTO loan_consents (consent_id, loan_id, role) VALUES ('CN-1','LN-1','loaner');`);
  // valid: blank loan_id is exempt (legacy rows)
  db.exec(`INSERT INTO loan_consents (consent_id, loan_id, role) VALUES ('CN-2','','loaner');`);
  // invalid: orphan
  assert.throws(
    () => db.exec(`INSERT INTO loan_consents (consent_id, loan_id, role) VALUES ('CN-3','LN-MISSING','guarantor');`),
    /non-existent/, 'an orphan consent must be rejected'
  );
  db.close();
});

test('M-34: the loan_guarantors FK trigger recipe rejects orphan guarantor rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('loans_expenses.sql'));
  db.exec(extractTrigger(migFor('10-loans-referential-integrity.sql'), 'trg_loan_guarantors_loan_fk_ins'));

  db.exec(`INSERT INTO loans (loan_id, amount) VALUES ('LN-9', 100);`);
  db.exec(`INSERT INTO loan_guarantors (loan_id, loaner, guarantor) VALUES ('LN-9','USER1','USER2');`); // ok
  assert.throws(
    () => db.exec(`INSERT INTO loan_guarantors (loan_id, loaner, guarantor) VALUES ('LN-X','USER1','USER2');`),
    /non-existent/
  );
  db.close();
});

test('M-35: the role CHECK trigger recipe rejects a role outside loaner/guarantor', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('loans_expenses.sql'));
  db.exec(extractTrigger(migFor('11-domain-check-constraints.sql'), 'trg_loan_consents_role_ins'));

  db.exec(`INSERT INTO loan_consents (consent_id, role) VALUES ('CN-1','loaner');`);   // ok
  db.exec(`INSERT INTO loan_consents (consent_id, role) VALUES ('CN-2','guarantor');`); // ok
  assert.throws(
    () => db.exec(`INSERT INTO loan_consents (consent_id, role) VALUES ('CN-3','banana');`),
    /must be loaner or guarantor/
  );
  db.close();
});

test('M-35: the non-negative amount trigger recipes reject negative money', () => {
  const dbL = new DatabaseSync(':memory:');
  dbL.exec(schemaFor('loans_expenses.sql'));
  dbL.exec(extractTrigger(migFor('11-domain-check-constraints.sql'), 'trg_loans_amount_nonneg_ins'));
  dbL.exec(`INSERT INTO loans (loan_id, amount) VALUES ('LN-1', 0);`);   // zero ok
  dbL.exec(`INSERT INTO loans (loan_id, amount) VALUES ('LN-2', 500);`); // positive ok
  assert.throws(() => dbL.exec(`INSERT INTO loans (loan_id, amount) VALUES ('LN-3', -1);`), />= 0/);
  dbL.close();

  const dbC = new DatabaseSync(':memory:');
  dbC.exec(schemaFor('collections.sql'));
  dbC.exec(extractTrigger(migFor('11-domain-check-constraints.sql'), 'trg_collections_amount_nonneg_ins'));
  dbC.exec(`INSERT INTO collections (sl_no, amount) VALUES (1, 100);`); // ok
  assert.throws(() => dbC.exec(`INSERT INTO collections (sl_no, amount) VALUES (2, -100);`), />= 0/);
  dbC.close();
});

test('M-34/M-35: the migration files apply as a NO-OP against the live schema (they touch no data)', () => {
  for (const f of ['10-loans-referential-integrity.sql', '11-domain-check-constraints.sql']) {
    const db = new DatabaseSync(':memory:');
    db.exec(schemaFor('loans_expenses.sql'));
    const before = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'`).get().n;
    db.exec(migFor(f));       // running the file as shipped
    db.exec(migFor(f));       // twice
    const after = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'`).get().n;
    assert.equal(after, before, `${f} must create nothing when applied as shipped (it is all comments)`);
    db.close();
  }
});
