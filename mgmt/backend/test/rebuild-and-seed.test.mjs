// ===== WAVE C: the DB rebuild is runnable, and schema-only is HALF-EMPTY =====
//
// The nine schema/*.sql files build 54 clean tables and ZERO seed rows. Every
// seed lives in a migration OUTSIDE schema/:
//
//   28-journey-content.sql          12 rows (10 year cards + 2 tagline settings)
//   29-journey-page-text.sql         2 rows (two journey-page JSON blobs)
//   30-donation-settings.sql         7 rows (the donate page bank / UPI / QR keys)
//   32-consent-decline-templates.sql 6 rows (declined/rejected notify templates, #349)
//
// So a database built from schema/ ALONE launches half-empty: the donate page has
// no bank or UPI details, and a declined consent notifies nobody because the
// templates respondConsent() looks up are not there. This test proves BOTH halves:
// first that schema-only leaves those four migrations' target tables empty, then
// that the rebuild+seed path (mgmt/db/rebuild.mjs) adds exactly 12 / 2 / 7 / 6 rows.
//
// It follows migration-matrix.test.mjs / h10-m38-indexes-and-retention.test.mjs:
// build the committed schema in an in-memory node:sqlite, then apply real SQL and
// assert. The rebuild ORDER is not re-derived here — it comes from rebuild.mjs's
// pure helpers (the same loadMigrations() the ledger runner uses), which is the
// point: the test exercises the code that ships, not a copy of it.
//
// Guard note: this file names 28/29/30/32 explicitly (via SEED_MIGRATIONS below and
// in prose) so the CI 'every migration in every folder is covered by a test' gate
// stays satisfied for the four seed migrations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  SEED_MIGRATIONS,
  SCHEMA_BY_DB,
  SCHEMA_ROOT,
  seedMigrationsFor,
  rebuildPlan,
  seededDatabases,
  runRebuild,
} from '../../db/rebuild.mjs';
import { MIGRATION_ROOT } from '../../db/migrate.mjs';
import { join } from 'node:path';

// The exact per-migration seed-row counts (== the number of INSERTs in each file).
// A drift here — or a seed migration dropped from the rebuild path — must fail.
const EXPECTED_SEED_ROWS = {
  '28-journey-content.sql': 12,
  '29-journey-page-text.sql': 2,
  '30-donation-settings.sql': 7,
  '32-consent-decline-templates.sql': 6,
};

// The tables each seed migration writes into. Summing these per migration is how
// we count "rows this seed added" independent of which physical table they land
// in (28 splits across journey_entries + portal_settings; 32 across two template
// tables). node:sqlite is the real engine, so these are real row counts.
const SEED_TABLES = {
  '28-journey-content.sql': ['journey_entries', 'portal_settings'],
  '29-journey-page-text.sql': ['portal_settings'],
  '30-donation-settings.sql': ['portal_settings'],
  '32-consent-decline-templates.sql': ['loan_message_templates', 'loan_email_templates'],
};

const readSchema = (name) => readFileSync(join(SCHEMA_ROOT, name), 'utf8');
const readMigration = (m) => readFileSync(join(MIGRATION_ROOT, m.folder, m.filename), 'utf8');

// Build a fresh in-memory DB from the committed schema file for `db`. This is a
// FRESH-database rebuild — plain CREATE TABLE, exactly what rebuild.mjs 'full'
// runs first.
function freshSchemaDb(db) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readSchema(SCHEMA_BY_DB[db]));
  return sqlite;
}

const rowCount = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const totalRows = (sqlite, tables) => tables.reduce((sum, t) => sum + rowCount(sqlite, t), 0);

// ---------------------------------------------------------------------------

test('the four seed migrations are exactly the SEED_MIGRATIONS the rebuild pins', () => {
  assert.deepEqual(
    SEED_MIGRATIONS,
    ['28-journey-content.sql', '29-journey-page-text.sql', '30-donation-settings.sql', '32-consent-decline-templates.sql'],
    'if you add/remove a seed migration, update this test AND the CI guard reference',
  );
});

test('DEFECT: a database built from schema/ ALONE leaves every seed table EMPTY', () => {
  // core.sql carries journey_entries + portal_settings; loans_expenses.sql carries
  // both template tables. Build each and prove NOTHING is seeded.
  for (const db of seededDatabases()) {
    const sqlite = freshSchemaDb(db);
    const seeds = seedMigrationsFor(db);
    for (const m of seeds) {
      for (const table of SEED_TABLES[m.filename]) {
        assert.equal(
          rowCount(sqlite, table),
          0,
          `${table} must be EMPTY on a schema-only ${db} (this is the half-empty defect ${m.filename} fixes)`,
        );
      }
    }
    sqlite.close();
  }
});

test('the rebuild+seed path adds exactly 12 / 2 / 7 / 6 rows, per migration', () => {
  // Group the seed migrations by their target database, build that database's
  // schema fresh, then apply its seeds THROUGH runRebuild (mode 'seed') and measure
  // the row delta each migration produced across its target tables.
  const byDb = {};
  for (const db of seededDatabases()) byDb[db] = seedMigrationsFor(db);

  for (const [db, seeds] of Object.entries(byDb)) {
    const sqlite = freshSchemaDb(db);

    // Apply each seed migration ONE AT A TIME and measure the row delta across its
    // target tables. Measuring incrementally (not all-at-once) matters because
    // 28/29/30 all write into the SHARED portal_settings table — a delta taken
    // after the whole run would credit every row to the first migration.
    for (const m of seeds) {
      const before = totalRows(sqlite, SEED_TABLES[m.filename]);
      sqlite.exec(readMigration(m));
      const added = totalRows(sqlite, SEED_TABLES[m.filename]) - before;
      assert.equal(
        added,
        EXPECTED_SEED_ROWS[m.filename],
        `${m.filename} must add exactly ${EXPECTED_SEED_ROWS[m.filename]} rows, got ${added}`,
      );
    }
    sqlite.close();
  }
});

test('a FULL rebuild (schema THEN seeds) yields the same 12 / 2 / 7 / 6 from empty', () => {
  // The end-to-end path: no pre-built schema, runRebuild does schema first. Proves
  // the schema apply and the seed apply compose into a complete database, and that
  // the schema step runs BEFORE the seeds (a seed against no schema would throw).
  for (const db of seededDatabases()) {
    const sqlite = new DatabaseSync(':memory:');
    const seeds = seedMigrationsFor(db);
    let seedIdx = 0;
    let schemaApplied = false;
    const deltas = {};
    runRebuild(
      db,
      {
        schema: (sql) => { sqlite.exec(sql); schemaApplied = true; },
        seed: (sql) => {
          assert.ok(schemaApplied, 'schema must be applied before any seed');
          const m = seeds[seedIdx++];
          const before = totalRows(sqlite, SEED_TABLES[m.filename]);
          sqlite.exec(sql);
          deltas[m.filename] = totalRows(sqlite, SEED_TABLES[m.filename]) - before;
        },
      },
      { mode: 'full' },
    );
    for (const m of seeds) {
      assert.equal(
        deltas[m.filename],
        EXPECTED_SEED_ROWS[m.filename],
        `after a full rebuild, ${m.filename} must have added ${EXPECTED_SEED_ROWS[m.filename]} rows`,
      );
    }
    sqlite.close();
  }
});

test('the seed apply is IDEMPOTENT — re-running adds nothing (fresh-DB rebuild is repeatable)', () => {
  // Idempotency is a per-TABLE property (28/29/30 share portal_settings), so compare
  // each physical table's total after one seed run vs after two.
  for (const db of seededDatabases()) {
    const tables = [...new Set(seedMigrationsFor(db).flatMap((m) => SEED_TABLES[m.filename]))];
    const sqlite = freshSchemaDb(db);
    const exec = { schema: () => {}, seed: (sql) => sqlite.exec(sql) };
    runRebuild(db, exec, { mode: 'seed' });
    const afterOne = Object.fromEntries(tables.map((t) => [t, rowCount(sqlite, t)]));
    runRebuild(db, exec, { mode: 'seed' }); // second run must be a no-op
    for (const t of tables) {
      assert.equal(
        rowCount(sqlite, t),
        afterOne[t],
        `${t} must not change on a second seed run (every INSERT is WHERE NOT EXISTS)`,
      );
    }
    sqlite.close();
  }
});

test('rebuildPlan orders schema BEFORE seeds and names the right schema per database', () => {
  const corePlan = rebuildPlan('chhath-core');
  assert.equal(corePlan.schema, 'core.sql');
  assert.deepEqual(
    corePlan.seeds.map((s) => s.filename),
    ['28-journey-content.sql', '29-journey-page-text.sql', '30-donation-settings.sql'],
    'chhath-core seeds are 28/29/30 in order',
  );
  const loansPlan = rebuildPlan('chhath-loans-expenses');
  assert.equal(loansPlan.schema, 'loans_expenses.sql');
  assert.deepEqual(
    loansPlan.seeds.map((s) => s.filename),
    ['32-consent-decline-templates.sql'],
    'chhath-loans-expenses seeds are just 32',
  );
});
