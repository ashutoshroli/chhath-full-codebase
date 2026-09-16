// The committed schema must be the END STATE, not a starting point.
//
// THE PROBLEM THIS EXISTS BECAUSE OF.
//
// `db/schema/*.sql` was treated as a historical snapshot, with later additions living
// only in `db/migration/`. Measured: **40 indexes and 10 columns** existed in migrations
// and nowhere in the schema. So a database created from the schema alone was missing:
//
//   * login_users' five TOTP columns  -> two-factor authentication silently absent
//   * users.photo                     -> no profile photos
//   * error_log.client_ip             -> the public per-visitor cap has nothing to count
//   * three ai_providers columns      -> the AI code cannot use the table
//   * uq_error_log_error_id (UNIQUE)  -> duplicate error ids accepted
//   * idx_portal_settings_key (UNIQUE)-> duplicate settings keys accepted
//
// And the drift ran in the DANGEROUS DIRECTION. Every schema test applies these files,
// so the test suite was MORE PERMISSIVE than production: a duplicate `error_log.error_id`
// inserted cleanly against the committed schema while the live database rejects it. A bug
// production would catch, the tests would not.
//
// That mattered more than usual here, because the portal had not launched: the first real
// database was going to be built from these files.
//
// WHAT THIS TEST ASSERTS, and why it is shaped this way.
//
// Not "the schema equals the sum of the migrations" — that would be a second
// implementation of the migrations, and would have to be kept in step by hand, which is
// the problem it is trying to solve. It asserts the one property that matters: **nothing
// a migration creates is absent from the schema.** The schema may contain more (it has
// tables no migration ever touched); it may not contain less.
//
// Run: node --test mgmt/backend/test/schema-is-the-end-state.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const SCHEMA_DIR = new URL('../../db/schema/', import.meta.url);
const MIGRATION_ROOT = new URL('../../db/migration/', import.meta.url);

// Database name -> schema file. The same map the migration matrix uses; a migration
// declares its database in its own "Apply with:" line (guarded by
// migration-target-databases.test.mjs), so routing needs no second list.
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

const schemaSql = (f) => readFileSync(new URL(f, SCHEMA_DIR), 'utf8');

function migrations() {
  const out = [];
  for (const folder of readdirSync(MIGRATION_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const dir = new URL(`${folder}/`, MIGRATION_ROOT);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      out.push({ rel: `${folder}/${file}`, file, sql: readFileSync(new URL(file, dir), 'utf8') });
    }
  }
  return out;
}

/** Databases a migration names, in any of the three forms in use. */
function declaredDatabases(sql) {
  return [...new Set([
    ...[...sql.matchAll(/wrangler\s+d1\s+execute\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]),
    ...[...sql.matchAll(/Section\s+[A-Z]\s*(?:->|—\s*DB:)\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1]),
  ])];
}

/** Strip comments so a statement quoted in prose is not mistaken for one that runs. */
const live = (sql) => sql.replace(/--.*$/gm, '');

/** Objects a schema file actually produces, read from the database it builds. */
function objectsOf(schemaFile) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(schemaSql(schemaFile));
    const rows = db.prepare(
      "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
    ).all();
    const columns = {};
    for (const r of rows.filter((x) => x.type === 'table')) {
      columns[r.name] = new Set(db.prepare(`PRAGMA table_info(${r.name})`).all().map((c) => c.name));
    }
    return {
      indexes: new Set(rows.filter((r) => r.type === 'index').map((r) => r.name)),
      triggers: new Set(rows.filter((r) => r.type === 'trigger').map((r) => r.name)),
      tables: new Set(Object.keys(columns)),
      columns,
    };
  } finally {
    db.close();
  }
}

const SCHEMAS = Object.fromEntries(
  Object.entries(SCHEMA_BY_DB).map(([db, f]) => [db, objectsOf(f)])
);

describe('the schema builds, and this test can see it', () => {
  test('every schema file produces a usable database', () => {
    // If a schema file failed to execute, every assertion below would be vacuous.
    for (const [db, objs] of Object.entries(SCHEMAS)) {
      assert.ok(objs.tables.size > 0, `${SCHEMA_BY_DB[db]} produced no tables`);
    }
    // Spot-checks on the additions this test was written for, so a silent revert shows up
    // as a named failure rather than as a mystery elsewhere.
    assert.ok(SCHEMAS['chhath-core'].columns.login_users.has('totp_enabled'), 'TOTP columns');
    assert.ok(SCHEMAS['chhath-core'].columns.users.has('photo'), 'users.photo');
    assert.ok(SCHEMAS['chhath-logs'].columns.error_log.has('client_ip'), 'error_log.client_ip');
    assert.ok(SCHEMAS['chhath-logs'].columns.ai_providers.has('purpose'), 'ai_providers.purpose');
    assert.ok(SCHEMAS['chhath-logs'].indexes.has('uq_error_log_error_id'), 'uq_error_log_error_id');
    assert.ok(SCHEMAS['chhath-core'].indexes.has('idx_portal_settings_key'), 'idx_portal_settings_key');
  });

  test('a fresh database rejects what production rejects', () => {
    // The concrete proof that the drift ran the dangerous way. Before this change, this
    // insert SUCCEEDED against the committed schema while the live database refused it —
    // so the tests were more permissive than production.
    const db = new DatabaseSync(':memory:');
    db.exec(schemaSql('logs.sql'));
    const ins = (id) => db.prepare(
      'INSERT INTO error_log (error_id, source, page, message, created_at, reported) VALUES (?,?,?,?,?,0)'
    ).run(id, 's', 'p', 'm', '2026-01-01');
    ins('ERRDUP');
    assert.throws(() => ins('ERRDUP'), /UNIQUE|constraint/i, 'a duplicate error_id must be refused');
    db.close();

    // Same for the settings key/value table, where a duplicate key makes reads
    // (`WHERE "key" = ? ... first()`) return an arbitrary one of two values.
    const core = new DatabaseSync(':memory:');
    core.exec(schemaSql('core.sql'));
    const put = (k) => core.prepare('INSERT INTO portal_settings ("key", value) VALUES (?, ?)').run(k, 'v');
    put('journey_tagline_en');
    assert.throws(() => put('journey_tagline_en'), /UNIQUE|constraint/i);
    core.close();
  });
});

describe('applying the schema to an existing database is not a full reset', () => {
  // Most tables begin with `DROP TABLE IF EXISTS`, so re-applying the schema recreates
  // them empty. NINE do not — they use `CREATE TABLE IF NOT EXISTS` with no DROP, so
  // their old rows SURVIVE. That is the trap in "just re-apply the schema to reset":
  // a partial reset is worse than none, because it looks complete.
  //
  // The list is pinned rather than fixed, because IF NOT EXISTS is right for these:
  // several were added by a later migration and must not destroy data on a database that
  // already has them. What was missing was anyone writing down that a reset therefore
  // needs explicit drops — runbook §W8g step 1 does now, and this keeps the two in step.
  const NO_DROP = {
    'loans_expenses.sql': ['loan_email_templates'],
    'logs.sql': ['ai_fixes', 'ai_providers'],
    'misc.sql': ['collection_jobs', 'render_jobs'],
    'whatsapp_index.sql': ['email_message_templates', 'email_messages', 'official_emails'],
  };

  test('the tables a re-apply does NOT empty are exactly the documented eight', () => {
    const found = {};
    for (const file of new Set(Object.values(SCHEMA_BY_DB))) {
      const sql = schemaSql(file);
      const dropped = new Set([...sql.matchAll(/DROP TABLE IF EXISTS (\w+)/g)].map((m) => m[1]));
      const survives = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)]
        .map((m) => m[1]).filter((t) => !dropped.has(t));
      if (survives.length) found[file] = survives;
    }
    assert.deepEqual(
      found, NO_DROP,
      'a table changed whether it survives a schema re-apply. If a NEW one is here, ' +
      'runbook §W8g step 1 must drop it too, or a "reset" will silently keep its rows.'
    );
  });

  test('the count matches what the runbook tells an operator to drop', () => {
    // Eight. This assertion was written saying nine, and failed on its first run —
    // which is what it is for: the runbook lists these tables by name, and a number
    // that disagrees with the list is how an operator drops seven of them and assumes
    // they are done.
    const total = Object.values(NO_DROP).reduce((n, xs) => n + xs.length, 0);
    assert.equal(total, 8, 'the runbook says eight tables; keep the number honest');
  });
});

describe('nothing a migration creates is missing from the schema', () => {
  const all = migrations();

  test('the migration walk found the files', () => {
    assert.ok(all.length >= 49, `only found ${all.length} migrations`);
  });

  test('every index a migration creates exists in the schema it targets', () => {
    const missing = [];
    for (const m of all) {
      const dbs = declaredDatabases(m.sql);
      for (const stmt of live(m.sql).matchAll(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)\s+ON\s+(\w+)/gi
      )) {
        const [, idx, tbl] = stmt;
        // Route to the declared database that actually owns the table. A multi-database
        // file names three, and only one of them has this table.
        const owner = dbs.find((d) => SCHEMAS[d] && SCHEMAS[d].tables.has(tbl));
        if (!owner) continue; // a table this migration also creates elsewhere; nothing to compare
        if (!SCHEMAS[owner].indexes.has(idx)) missing.push(`${m.rel}: ${idx} on ${tbl} (${owner})`);
      }
    }
    assert.deepEqual(
      missing, [],
      'these indexes exist only in a migration, so a database built from the schema is ' +
      `missing them:\n  ${missing.join('\n  ')}`
    );
  });

  test('every column a migration adds exists in the schema it targets', () => {
    const missing = [];
    for (const m of all) {
      const dbs = declaredDatabases(m.sql);
      for (const stmt of live(m.sql).matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi)) {
        const [, tbl, col] = stmt;
        const owner = dbs.find((d) => SCHEMAS[d] && SCHEMAS[d].tables.has(tbl));
        if (!owner) continue;
        if (!SCHEMAS[owner].columns[tbl].has(col)) missing.push(`${m.rel}: ${tbl}.${col} (${owner})`);
      }
    }
    assert.deepEqual(
      missing, [],
      'these columns exist only in a migration, so a database built from the schema is ' +
      `missing them — which is how two-factor auth and profile photos were absent:\n  ${missing.join('\n  ')}`
    );
  });

  test('every trigger a migration creates exists in the schema it targets', () => {
    const missing = [];
    for (const m of all) {
      const dbs = declaredDatabases(m.sql);
      for (const stmt of live(m.sql).matchAll(
        /CREATE\s+TRIGGER\s+(?:IF NOT EXISTS\s+)?(\w+)\s+BEFORE\s+\w+(?:\s+OF\s+\w+)?\s+ON\s+(\w+)/gi
      )) {
        const [, trg, tbl] = stmt;
        const owner = dbs.find((d) => SCHEMAS[d] && SCHEMAS[d].tables.has(tbl));
        if (!owner) continue;
        if (!SCHEMAS[owner].triggers.has(trg)) missing.push(`${m.rel}: ${trg} on ${tbl} (${owner})`);
      }
    }
    assert.deepEqual(
      missing, [],
      'these triggers exist only in a migration, so a fresh database has no enforcement ' +
      `of the loan relations at all:\n  ${missing.join('\n  ')}`
    );
  });
});

describe('a fresh database enforces what the migrations enforce', () => {
  test('the loan-relation triggers are live in a schema-built database', () => {
    // The H-8 orphan case, against the schema alone — no migrations applied.
    const db = new DatabaseSync(':memory:');
    db.exec(schemaSql('loans_expenses.sql'));
    db.prepare('INSERT INTO loans (year, loan_id, name) VALUES (?,?,?)').run(2026, 'LN-1', 'USER0001');

    const addConsent = (loanId) => db.prepare(
      'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, status) VALUES (?,?,?,?,?)'
    ).run('CN1', loanId, 'USER0002', 'loaner', 'pending');

    addConsent('LN-1'); // legitimate
    assert.throws(() => db.prepare(
      'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, status) VALUES (?,?,?,?,?)'
    ).run('CN2', 'LN-GONE', 'U', 'loaner', 'pending'), /does not exist/);
    // And the update half, which migration 10 never had.
    assert.throws(
      () => db.prepare("UPDATE loan_consents SET loan_id = 'LN-GONE' WHERE consent_id = 'CN1'").run(),
      /re-pointed/
    );
    db.close();
  });

  test('the unique business keys are live in a schema-built database', () => {
    const core = new DatabaseSync(':memory:');
    core.exec(schemaSql('core.sql'));
    core.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').run('USER0007', 'A');
    assert.throws(() => core.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').run('USER0007', 'B'),
      /UNIQUE|constraint/i);
    // Partial: blanks stay exempt, so legacy rows need no backfill.
    core.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').run('', 'C');
    core.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').run('', 'D');
    core.close();

    const col = new DatabaseSync(':memory:');
    col.exec(schemaSql('collections.sql'));
    col.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?,?,?)').run(2026, 45, 'U1');
    assert.throws(() => col.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?,?,?)').run(2026, 45, 'U2'),
      /UNIQUE|constraint/i);
    col.close();
  });

  test('year is an INTEGER in a schema-built database', () => {
    // Why this matters: the live database still holds REAL years (2024.0) because
    // migration 12's REAL->INTEGER conversion is a rebuild RECIPE that applies nothing.
    // A database created from this schema does not inherit that — so recreating is also
    // how M-33 finally gets fixed, without any rebuild.
    const db = new DatabaseSync(':memory:');
    db.exec(schemaSql('collections.sql'));
    const col = db.prepare('PRAGMA table_info(collections)').all().find((c) => c.name === 'year');
    assert.equal(col.type, 'INTEGER');
    db.close();
  });
});
