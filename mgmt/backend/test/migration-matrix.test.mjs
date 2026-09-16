// ============ EVERY MIGRATION, IN EVERY FOLDER, DECLARED ============
//
// Carry-over C6: "Migration CI only scans `mgmt/db/migration/2026-09-05/` — older folders have
// uncovered files, and widening it fails today."
//
// Widening it does fail, and the reasons turn out to be worth knowing. Twelve files in the three
// older folders were covered by nothing at all, and they are not all the same kind of thing:
//
//   * nine apply cleanly and idempotently against one committed schema;
//   * two — `2026-09-02/02-perf-indexes.sql` and `03-scalability-indexes.sql` — **cannot be
//     applied as a whole file to any single database.** They carry indexes for three different
//     D1 databases and say so in their own headers ("Run EACH section against the DB named in
//     its header, NOT all at once"). A `CREATE INDEX` on a table that lives in another database
//     does not skip, it fails — so running one of these files whole is guaranteed to break
//     part-way through, having applied the earlier sections.
//   * one — `2026-09-01/03-whatsapp_index.sql` — is already fully reflected in the committed
//     schema, so against a fresh schema its `ALTER` can only fail with "duplicate column".
//
// So the test does not ask "does every file apply". It asks a better question: **is every file's
// relationship to the committed schema DECLARED?** A migration nobody has classified is the
// thing that reaches a live database unverified, and that is what this closes.
//
// It is also the precondition for the migration ledger (PR-35): you cannot build a runner that
// applies migrations in order until every file's target and expected outcome is written down.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATION_ROOT = new URL('../../db/migration/', import.meta.url);
const SCHEMA_DIR = new URL('../../db/schema/', import.meta.url);

const schemaFor = (name) => readFileSync(new URL(name, SCHEMA_DIR), 'utf8');
const readMigration = (rel) => readFileSync(new URL(rel, MIGRATION_ROOT), 'utf8');

const folders = () =>
  readdirSync(MIGRATION_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

const filesIn = (folder) =>
  readdirSync(new URL(`${folder}/`, MIGRATION_ROOT)).filter((f) => f.endsWith('.sql')).sort();

// The D1 database names, as they appear in the migration headers, mapped to the committed
// schema that describes them.
const SCHEMA_BY_DB = {
  'chhath-core': 'core.sql',
  'chhath-collections': 'collections.sql',
  'chhath-loans-expenses': 'loans_expenses.sql',
  'chhath-file-index': 'file_index.sql',
  'chhath-misc': 'misc.sql',
  'chhath-logs': 'logs.sql',
  'chhath-templates': 'templates.sql',
  'chhath-whatsapp-index': 'whatsapp_index.sql',
  'chhath-audit': 'audit.sql',
};

// ---- The declaration. Every file in every folder must appear here. ----
//
//   { schema }          applies against that schema, twice, cleanly
//   { sections: true }  a MULTI-DATABASE file: each `-- Section X — DB: <name>` block is applied
//                       against the schema for the DB it names. Whole-file application is not
//                       expected to work and is asserted NOT to.
//   { alreadyInSchema }  historical: the change is in the committed schema, so a fresh apply
//                        must fail on the duplicate. The reason is recorded.
const DECLARED = {
  // ---- 2026-09-01 — the original per-database rebuilds ----
  '2026-09-01/01-file_index.sql': { schema: 'file_index.sql' },
  '2026-09-01/02-templates.sql': { schema: 'templates.sql' },
  '2026-09-01/03-whatsapp_index.sql': {
    alreadyInSchema: 'adds official_emails.doc_sub_type, which whatsapp_index.sql already declares',
  },
  '2026-09-01/04-logs.sql': { schema: 'logs.sql' },
  '2026-09-01/05-popups-active.sql': { schema: 'misc.sql' },
  '2026-09-01/06-popup-image-urls.sql': { schema: 'misc.sql' },
  '2026-09-01/07-consent-image-urls.sql': { schema: 'loans_expenses.sql' },
  '2026-09-01/08-public-data-version.sql': { schema: 'core.sql' },

  // ---- 2026-09-02 ----
  '2026-09-02/01-collection-jobs.sql': { schema: 'misc.sql' },
  // These two are the reason C6 said widening fails: three databases in one file.
  '2026-09-02/02-perf-indexes.sql': { sections: true },
  '2026-09-02/03-scalability-indexes.sql': { sections: true },

  // ---- 2026-09-04 ----
  '2026-09-04/01-audit-sessions-logins.sql': { schema: 'audit.sql' },
};

// 2026-09-05 is already covered file-by-file, against the committed schema and twice over, by
// h10-m38-indexes-and-retention.test.mjs. Duplicating it here would mean two lists to keep in
// step, so this suite defers to that one and only asserts the folder is not FORGOTTEN.
const DELEGATED_FOLDERS = new Set(['2026-09-05']);

/** Splits a multi-database migration into its declared sections. */
function sectionsOf(sql) {
  const out = [];
  const re = /^--\s*Section\s+([A-Z])\s+[—-]\s*DB:\s*([a-z0-9-]+)\s*$/gim;
  const marks = [...sql.matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : sql.length;
    out.push({ letter: marks[i][1], db: marks[i][2], sql: sql.slice(start, end) });
  }
  return out;
}

describe('every migration file is declared (C6)', () => {
  test('no file in any folder is unclassified', () => {
    const undeclared = [];
    for (const folder of folders()) {
      if (DELEGATED_FOLDERS.has(folder)) continue;
      for (const f of filesIn(folder)) {
        const key = `${folder}/${f}`;
        if (!DECLARED[key]) undeclared.push(key);
      }
    }
    // This is the gate. A NEW migration dropped into any folder fails here until someone has
    // said which database it targets and what applying it is supposed to do.
    assert.deepEqual(undeclared, [],
      'add each of these to DECLARED, saying which schema it targets');
  });

  test('the declaration has no entries for files that no longer exist', () => {
    const present = new Set();
    for (const folder of folders()) {
      if (DELEGATED_FOLDERS.has(folder)) continue;
      for (const f of filesIn(folder)) present.add(`${folder}/${f}`);
    }
    const stale = Object.keys(DECLARED).filter((k) => !present.has(k));
    assert.deepEqual(stale, [], 'these declarations refer to files that are gone');
  });

  test('the delegated folder really is covered elsewhere', () => {
    // If h10's own list is ever deleted, this suite must not quietly become the only coverage
    // while believing something else has it.
    const h10 = readFileSync(new URL('./h10-m38-indexes-and-retention.test.mjs', import.meta.url), 'utf8');
    assert.match(h10, /SCHEMA_FOR_MIGRATION/);
    for (const f of filesIn('2026-09-05')) {
      assert.ok(h10.includes(f), `${f} is not in h10's SCHEMA_FOR_MIGRATION`);
    }
  });
});

describe('a single-database migration applies, twice', () => {
  for (const [key, decl] of Object.entries(DECLARED)) {
    if (!decl.schema) continue;
    test(`${key} applies against ${decl.schema} and is idempotent`, () => {
      const db = new DatabaseSync(':memory:');
      try {
        db.exec(schemaFor(decl.schema));
        const sql = readMigration(key);
        db.exec(sql);   // first run
        db.exec(sql);   // second run must be a no-op, not an error
      } finally { db.close(); }
    });
  }
});

describe('a multi-database migration is applied per section', () => {
  for (const [key, decl] of Object.entries(DECLARED)) {
    if (!decl.sections) continue;

    test(`${key} declares a DB for every section`, () => {
      const sections = sectionsOf(readMigration(key));
      assert.ok(sections.length >= 2, `expected several sections, found ${sections.length}`);
      for (const s of sections) {
        assert.ok(SCHEMA_BY_DB[s.db], `Section ${s.letter} names an unknown database: ${s.db}`);
      }
    });

    test(`${key} — each section applies against its own DB, twice`, () => {
      for (const s of sectionsOf(readMigration(key))) {
        const db = new DatabaseSync(':memory:');
        try {
          db.exec(schemaFor(SCHEMA_BY_DB[s.db]));
          db.exec(s.sql);
          db.exec(s.sql);
        } catch (e) {
          assert.fail(`Section ${s.letter} (${s.db}): ${e.message}`);
        } finally { db.close(); }
      }
    });

    test(`${key} cannot be applied as a whole file — which is why it says so`, () => {
      // Asserted, not assumed. If someone ever merges these sections into one applicable file,
      // this test should fail and be deleted deliberately — rather than the header's warning
      // quietly outliving the reason for it.
      let failed = false;
      const db = new DatabaseSync(':memory:');
      try {
        db.exec(schemaFor('loans_expenses.sql'));
        db.exec(readMigration(key));
      } catch (e) { failed = true; } finally { db.close(); }
      assert.equal(failed, true,
        'a CREATE INDEX on a table in another database fails rather than skipping');
    });

    test(`${key} tells the operator to run it section by section`, () => {
      // Comment markers and line breaks removed first: the sentence wraps across lines, and a
      // test that only matches it on one line would be satisfied by reflowing the paragraph.
      const header = readMigration(key)
        .slice(0, 2500)
        .replace(/^--\s?/gm, '')
        .replace(/\s+/g, ' ');
      assert.match(header, /Run EACH section against the DB named in its header/i);
      // And the count in the prose must match the sections that exist — a header saying "TWO
      // databases" above three sections is how an operator misses one.
      const n = sectionsOf(readMigration(key)).length;
      const words = { 2: 'TWO', 3: 'THREE', 4: 'FOUR' }[n];
      assert.match(header, new RegExp(`spans ${words} databases`, 'i'),
        `the header must say it spans ${words} databases, matching its ${n} sections`);
    });
  }
});

describe('a migration already reflected in the schema is recorded as such', () => {
  for (const [key, decl] of Object.entries(DECLARED)) {
    if (!decl.alreadyInSchema) continue;
    test(`${key} fails on a fresh schema, for the recorded reason`, () => {
      // The point is not that it fails — it is that we KNOW it fails, and why. An operator who
      // runs it against a live database that predates the schema will succeed; one who runs it
      // against a fresh one will see this error and can stop worrying.
      let message = null;
      const db = new DatabaseSync(':memory:');
      try {
        db.exec(schemaFor('whatsapp_index.sql'));
        db.exec(readMigration(key));
      } catch (e) { message = e.message; } finally { db.close(); }
      assert.ok(message, `${key} applied cleanly — its declaration is now wrong, remove it`);
      assert.match(message, /duplicate column/i);
      assert.ok(decl.alreadyInSchema.length > 20, 'the reason must actually say something');
    });
  }
});
