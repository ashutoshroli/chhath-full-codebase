// audit M-33 — prove the REAL->INTEGER/TEXT rebuild recipes are correct and that
// the migration files apply nothing as shipped.
//
// Files 2026-09-05/12 (INTEGER) and /13 (TEXT) ship only detection queries and
// documented table-rebuild recipes as comments — a blind `wrangler d1 execute` is a
// no-op. This test (a) confirms that no-op, and (b) runs the two representative
// rebuilds (collections INTEGER+utr->TEXT, users phone->TEXT) against the committed
// schema with REAL sample data and asserts the values round-trip correctly and the
// column affinity actually changed. So the recipes are proven, not just documented.
//
// Run: node --test mgmt/backend/test/m33-column-types.test.mjs

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

test('M-33: the migration files apply as a NO-OP against the live schema (all comments)', () => {
  const checks = [
    ['12-column-types-integer.sql', 'collections.sql', 'collections'],
    ['13-column-types-text.sql', 'core.sql', 'users'],
  ];
  for (const [file, schema, table] of checks) {
    const db = new DatabaseSync(':memory:');
    db.exec(schemaFor(schema));
    const cols = () => db.prepare(`SELECT name, type FROM pragma_table_info('${table}')`).all();
    const before = JSON.stringify(cols());
    db.exec(migFor(file));   // as shipped
    db.exec(migFor(file));   // twice
    assert.equal(JSON.stringify(cols()), before, `${file} must not change ${table} when applied as shipped`);
    db.close();
  }
});

test('M-33: the collections INTEGER + utr->TEXT rebuild recipe round-trips values and fixes types', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('collections.sql'));
  // Insert rows the way the Sheet export did: whole numbers stored as REAL, a UTR
  // that a REAL column would render with a trailing '.0'.
  db.exec(`INSERT INTO collections (year, sl_no, name, amount, contribution_type, utr, announcedcount)
           VALUES (2026.0, 12.0, 'Ramesh', 501.5, 1.0, '1234567890123', 3.0);`);

  // The rebuild recipe (kept in lock-step with 12-column-types-integer.sql PART 2).
  db.exec(`
    CREATE TABLE collections_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER, sl_no INTEGER, name TEXT, amount REAL, created_by TEXT,
      payment_mode TEXT, date TEXT, contribution_type INTEGER, detail TEXT,
      certificate_or_receipt TEXT, utr TEXT, is_resell TEXT, announced TEXT,
      announcedcount INTEGER
    );
    INSERT INTO collections_new
      SELECT id, CAST(year AS INTEGER), CAST(sl_no AS INTEGER), name, amount, created_by,
             payment_mode, date, CAST(contribution_type AS INTEGER), detail,
             certificate_or_receipt,
             CASE WHEN utr IS NULL OR utr = '' THEN utr ELSE CAST(CAST(utr AS INTEGER) AS TEXT) END,
             is_resell, announced,
             CAST(announcedcount AS INTEGER)
        FROM collections;
    DROP TABLE collections;
    ALTER TABLE collections_new RENAME TO collections;
  `);

  const row = db.prepare('SELECT * FROM collections WHERE name = ?').get('Ramesh');
  assert.equal(row.year, 2026);
  assert.equal(row.sl_no, 12);
  assert.equal(row.contribution_type, 1);
  assert.equal(row.announcedcount, 3);
  assert.equal(row.amount, 501.5, 'a genuinely fractional amount is preserved');
  assert.equal(row.utr, '1234567890123', 'utr stays a clean digit string');

  // The declared affinity actually changed.
  const typeOf = (c) => db.prepare(`SELECT type FROM pragma_table_info('collections') WHERE name = ?`).get(c).type;
  assert.equal(typeOf('year'), 'INTEGER');
  assert.equal(typeOf('utr'), 'TEXT');
  assert.equal(typeOf('amount'), 'REAL', 'amount stays REAL on purpose');
  db.close();
});

test('M-33: the users phone->TEXT rebuild strips the REAL ".0" and preserves 10 digits', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('core.sql'));
  // A phone stored as REAL comes back as 9876543210.0 — the exact corruption TEXT fixes.
  db.exec(`INSERT INTO users (id_code, name, mobile, whatsapp) VALUES ('USER0001', 'Sita', 9876543210.0, 9123456780.0);`);
  db.exec(`INSERT INTO users (id_code, name, mobile, whatsapp) VALUES ('USER0002', 'Gita', NULL, '');`);

  db.exec(`
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_code TEXT, name TEXT, village TEXT, fathers_name TEXT,
      mobile TEXT, designation TEXT, created_by TEXT, email TEXT,
      whatsapp TEXT, name_hindi TEXT, fathers_name_hindi TEXT,
      designation_hindi TEXT, village_hindi TEXT
    );
    INSERT INTO users_new SELECT
      id, id_code, name, village, fathers_name,
      CASE WHEN mobile   IS NULL OR mobile   = '' THEN mobile   ELSE CAST(CAST(mobile   AS INTEGER) AS TEXT) END,
      designation, created_by, email,
      CASE WHEN whatsapp IS NULL OR whatsapp = '' THEN whatsapp ELSE CAST(CAST(whatsapp AS INTEGER) AS TEXT) END,
      name_hindi, fathers_name_hindi, designation_hindi, village_hindi
    FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);

  const sita = db.prepare('SELECT mobile, whatsapp FROM users WHERE id_code = ?').get('USER0001');
  assert.equal(sita.mobile, '9876543210', 'the ".0" is gone and 10 digits remain');
  assert.equal(sita.whatsapp, '9123456780');
  assert.ok(/^\d{10}$/.test(sita.mobile), 'still passes the app 10-digit rule');

  const gita = db.prepare('SELECT mobile, whatsapp FROM users WHERE id_code = ?').get('USER0002');
  assert.equal(gita.mobile, null, 'a NULL phone stays NULL');
  assert.equal(gita.whatsapp, '', 'a blank phone stays blank');

  const typeOf = (c) => db.prepare(`SELECT type FROM pragma_table_info('users') WHERE name = ?`).get(c).type;
  assert.equal(typeOf('mobile'), 'TEXT');
  assert.equal(typeOf('whatsapp'), 'TEXT');
  db.close();
});
