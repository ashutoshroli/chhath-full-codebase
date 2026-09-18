// Guards the OPERATOR script mgmt/db/cleanup/2026-09-17-dropdown-lists-id-fix/
// fix-dropdown-lists-id.sql — the standalone (NOT a migration) table rebuild that
// restores dropdown_lists.id to INTEGER PRIMARY KEY AUTOINCREMENT on a live DB
// whose id column drifted to a plain INTEGER (see the script header for root cause).
//
// This test builds a DRIFTED table (id plain INTEGER, no PRIMARY KEY), seeds it
// with rows including id=1, applies the script through node:sqlite, and asserts
// the end state matches mgmt/db/schema/core.sql: id is a real PRIMARY KEY, all
// rows survive with ids intact, and an INSERT that omits id now gets a non-null
// autoincrement id (the exact behaviour that was broken on live).
//
// It lives in test/ (NOT db/migration/) on purpose, so the migration guards
// (h10-m38, migration-matrix, migration-target-databases, pr35-migration-ledger)
// do not scan it. node:sqlite emits an expected ExperimentalWarning — noise.
//
// Run: node --test mgmt/backend/test/dropdown-lists-id-fix.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const FIX_SQL = readFileSync(
  new URL('../../db/cleanup/2026-09-17-dropdown-lists-id-fix/fix-dropdown-lists-id.sql', import.meta.url),
  'utf8',
);

// The DRIFTED shape a `wrangler d1 export` + restore leaves behind: a plain
// `id INTEGER` with no PRIMARY KEY / AUTOINCREMENT.
const DRIFTED_SCHEMA = `
CREATE TABLE dropdown_lists (
  id INTEGER,
  list_type TEXT,
  english_value TEXT,
  hindi_label TEXT,
  active TEXT,
  sort_order INTEGER
);
CREATE INDEX idx_dropdown_lists_list_type ON dropdown_lists(list_type);
CREATE INDEX idx_dropdown_lists_active ON dropdown_lists(active);
`;

function makeDriftedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(DRIFTED_SCHEMA);
  db.prepare(
    `INSERT INTO dropdown_lists (id, list_type, english_value, hindi_label, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(1, 'Category', 'Lighting', 'रोशनी', 'yes', 1);
  db.prepare(
    `INSERT INTO dropdown_lists (id, list_type, english_value, hindi_label, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(2, 'Category', 'Prasad', 'प्रसाद', 'yes', 2);
  return db;
}

describe('fix-dropdown-lists-id.sql operator script', () => {
  test('confirms the drift the fix targets (id has no PRIMARY KEY before the fix)', () => {
    const db = makeDriftedDb();
    const idCol = db.prepare(`PRAGMA table_info(dropdown_lists)`).all().find((c) => c.name === 'id');
    assert.equal(idCol.pk, 0, 'precondition: drifted id must not be a primary key');
    db.close();
  });

  test('restores id to INTEGER PRIMARY KEY AUTOINCREMENT, keeps rows, and re-enables autoincrement', () => {
    const db = makeDriftedDb();

    // Apply the operator script exactly as `wrangler d1 execute --file` would.
    db.exec(FIX_SQL);

    // 1. id is now a PRIMARY KEY of INTEGER type.
    const cols = db.prepare(`PRAGMA table_info(dropdown_lists)`).all();
    const idCol = cols.find((c) => c.name === 'id');
    assert.ok(idCol, 'id column exists');
    assert.equal(idCol.pk, 1, 'id is the primary key after the fix');
    assert.equal(idCol.type, 'INTEGER', 'id is INTEGER');

    // AUTOINCREMENT is recorded in sqlite_sequence once a row is inserted, and the
    // committed table shape must match: id INTEGER PRIMARY KEY AUTOINCREMENT.
    const ddl = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='dropdown_lists'`)
      .get().sql;
    assert.match(ddl, /id\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/i, 'DDL declares AUTOINCREMENT');

    // 2. Rows survived with ids intact (id=1 'Lighting' preserved).
    const count = db.prepare(`SELECT COUNT(*) AS n FROM dropdown_lists`).get().n;
    assert.equal(Number(count), 2, 'both seeded rows survived');
    const row1 = db.prepare(`SELECT * FROM dropdown_lists WHERE id = 1`).get();
    assert.ok(row1, 'row id=1 still present');
    assert.equal(row1.english_value, 'Lighting');
    assert.equal(row1.list_type, 'Category');

    // 3. A fresh INSERT omitting id now gets a real, non-null autoincrement id —
    //    the behaviour that was silently failing on live.
    const res = db
      .prepare(
        `INSERT INTO dropdown_lists (list_type, english_value, hindi_label, active, sort_order)
           VALUES ('Category', 'NewItem', 'नया', 'yes', 3)`,
      )
      .run();
    const newId = Number(res.lastInsertRowid);
    assert.ok(newId > 2, 'new id is a real autoincrement value greater than existing max');
    const inserted = db.prepare(`SELECT id FROM dropdown_lists WHERE english_value = 'NewItem'`).get();
    assert.notEqual(inserted.id, null, 'inserted row has a non-null id');
    assert.equal(Number(inserted.id), newId, 'stored id matches the reported last_row_id');

    db.close();
  });

  test('uses no explicit SQL transaction statements (Cloudflare D1 rejects them)', () => {
    // `wrangler d1 execute --file` errors on raw BEGIN TRANSACTION / COMMIT /
    // SAVEPOINT — it applies the file's statements as one batch instead. Assert
    // the executable SQL carries none of those forbidden transaction-control
    // statements. Strip `-- ...` comment lines first so the header prose (which
    // explains WHY they are absent, quoting the D1 error) does not trip the check.
    const executableSql = FIX_SQL.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    assert.doesNotMatch(executableSql, /\bBEGIN\s+TRANSACTION\b/i, 'no BEGIN TRANSACTION');
    assert.doesNotMatch(executableSql, /\bCOMMIT\b/i, 'no COMMIT statement');
    assert.doesNotMatch(executableSql, /\bSAVEPOINT\b/i, 'no SAVEPOINT');
  });

  test('recreates both indexes from the committed schema', () => {
    const db = makeDriftedDb();
    db.exec(FIX_SQL);
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='dropdown_lists'`)
      .all()
      .map((r) => r.name);
    assert.ok(indexes.includes('idx_dropdown_lists_list_type'), 'list_type index recreated');
    assert.ok(indexes.includes('idx_dropdown_lists_active'), 'active index recreated');
    db.close();
  });
});
