// audit PR-35 — the migration ledger and runner.
//
// Asked "which migrations have you applied?", nobody could answer: not the operator,
// not the code, not CI. The consequences were not hypothetical — a privacy remediation
// was reported as applied when its command had failed (#360), and five migrations spent
// months telling people to run them against a database that does not exist.
//
// What is tested here is every decision the runner makes: what exists, what is pending,
// in what order, against which database, and whether a file still matches what was
// applied. All of it is pure functions over strings. The one impure part — shelling out
// to wrangler — is an injected `exec`, deliberately, because a real D1 database is not
// reachable from where this was written and the alternative would be shipping untested
// branching around an untestable call.
//
// Run: node --test mgmt/backend/test/pr35-migration-ledger.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { schemaFor } from './helpers/stubs.mjs';
import {
  checksum, hasExecutableSql, declaredDatabases, realDatabaseNames,
  loadMigrations, plan, recordSql, parseRows, ledgerSql, LEDGER_FILE, MIGRATION_ROOT,
} from '../../db/migrate.mjs';

const WRANGLER = new URL('../wrangler.toml', import.meta.url);

// A migration as the loader produces one.
const mig = (filename, database, sql = 'CREATE INDEX IF NOT EXISTS i ON t(c);', folder = '2026-09-05') => ({
  folder, filename, sql, databases: database ? [database] : [], database, kind: 'runnable', checksum: checksum(sql),
});

describe('the ledger table itself', () => {
  test('it applies to any schema, twice, and enforces one row per migration', () => {
    // It goes into EVERY database, so it must not assume anything about the schema
    // it lands in. Checked against two unrelated ones.
    for (const s of ['core.sql', 'logs.sql']) {
      const db = new DatabaseSync(':memory:');
      db.exec(schemaFor(s));
      db.exec(ledgerSql());
      db.exec(ledgerSql()); // idempotent
      db.prepare('INSERT INTO schema_migrations (folder, filename, checksum, applied_at) VALUES (?,?,?,?)')
        .run('2026-09-05', '34-core-unique-id-code.sql', 'abc', '2026-09-16T00:00:00.000Z');
      // The constraint that makes it a ledger: applied once.
      assert.throws(
        () => db.prepare('INSERT INTO schema_migrations (folder, filename, checksum, applied_at) VALUES (?,?,?,?)')
          .run('2026-09-05', '34-core-unique-id-code.sql', 'abc', '2026-09-16T00:00:01.000Z'),
        /UNIQUE|constraint/i
      );
      db.close();
    }
  });

  test('the recorded row is what a later run reads back', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(schemaFor('core.sql'));
    db.exec(ledgerSql());
    const m = mig('34-core-unique-id-code.sql', 'chhath-core');
    db.exec(recordSql(m, 'adopt', '2026-09-16T10:00:00.000Z'));

    const row = db.prepare('SELECT * FROM schema_migrations').get();
    assert.equal(row.filename, '34-core-unique-id-code.sql');
    assert.equal(row.folder, '2026-09-05');
    assert.equal(row.checksum, m.checksum);
    assert.equal(row.applied_by, 'adopt');
    // Round-trips into a clean plan: recorded means done, not pending.
    const p = plan([m], 'chhath-core', [row]);
    assert.deepEqual(p.pending, []);
    assert.equal(p.done.length, 1);
    assert.deepEqual(p.changed, []);
    db.close();
  });

  test("an operator's name with an apostrophe does not break the INSERT", () => {
    // recordSql builds SQL for `wrangler d1 execute --command`, which takes no bound
    // parameters, so the escaping is the only thing between a name and a broken
    // statement.
    const db = new DatabaseSync(':memory:');
    db.exec(schemaFor('core.sql'));
    db.exec(ledgerSql());
    db.exec(recordSql(mig('x.sql', 'chhath-core'), "O'Brien"));
    assert.equal(db.prepare('SELECT applied_by FROM schema_migrations').get().applied_by, "O'Brien");
    db.close();
  });
});

describe('what the runner decides', () => {
  const A = mig('01-a.sql', 'chhath-core');
  const B = mig('02-b.sql', 'chhath-core');
  const C = mig('03-c.sql', 'chhath-logs');

  test('only migrations for THIS database are pending here', () => {
    // The ledger is per-database. A migration for another database is not pending in
    // this one — treating it as pending would make every ledger permanently dirty.
    const p = plan([A, B, C], 'chhath-core', []);
    assert.deepEqual(p.pending.map((m) => m.filename), ['01-a.sql', '02-b.sql']);
    assert.deepEqual(plan([A, B, C], 'chhath-logs', []).pending.map((m) => m.filename), ['03-c.sql']);
  });

  test('an applied migration is not re-applied', () => {
    const rows = [{ filename: '01-a.sql', checksum: A.checksum }];
    const p = plan([A, B], 'chhath-core', rows);
    assert.deepEqual(p.pending.map((m) => m.filename), ['02-b.sql']);
    assert.deepEqual(p.done.map((m) => m.filename), ['01-a.sql']);
  });

  test('a file edited after being applied is reported, not silently re-run', () => {
    // The one thing a ledger keyed only on a name cannot see. Editing an applied
    // migration is a normal mistake — a typo fix in a comment, or worse in a statement.
    const rows = [{ filename: '01-a.sql', checksum: 'a-different-checksum' }];
    const p = plan([A], 'chhath-core', rows);
    assert.deepEqual(p.changed.map((m) => m.filename), ['01-a.sql']);
    // Still counted as applied: the fix is a human decision, not a re-run.
    assert.deepEqual(p.pending, []);
    assert.equal(p.done.length, 1);
    assert.equal(p.changed[0].appliedChecksum, 'a-different-checksum');
  });

  test('a ledger row whose file is gone is reported', () => {
    const p = plan([A], 'chhath-core', [
      { filename: '01-a.sql', checksum: A.checksum },
      { filename: '99-renamed-or-deleted.sql', checksum: 'x' },
    ]);
    assert.deepEqual(p.orphaned.map((r) => r.filename), ['99-renamed-or-deleted.sql']);
  });

  test('a multi-database file is REFUSED, not guessed at', () => {
    // These apply section-by-section against different databases; running the whole
    // file applies the earlier sections and then fails part-way (#353). A runner that
    // attempted it would leave the operator worse off than one that declines.
    const multi = {
      ...mig('02-perf-indexes.sql', null, 'CREATE INDEX IF NOT EXISTS i ON t(c);', '2026-09-02'),
      databases: ['chhath-core', 'chhath-collections'], database: null, kind: 'multi-db',
    };
    const p = plan([multi], 'chhath-core', []);
    assert.deepEqual(p.pending, [], 'must not be queued for automatic apply');
    assert.deepEqual(p.blocked.map((m) => m.filename), ['02-perf-indexes.sql']);
  });

  test('an executable migration naming no database is refused, not skipped', () => {
    // Cannot happen while migration-target-databases.test.mjs passes. Handled anyway:
    // a runner that silently skips a migration is worse than one that refuses.
    const unrouted = { ...mig('50-x.sql', null), databases: [], database: null, kind: 'unrouted' };
    const p = plan([unrouted], 'chhath-core', []);
    assert.deepEqual(p.pending, []);
    assert.deepEqual(p.blocked.map((m) => m.filename), ['50-x.sql']);
  });
});

describe('against the real migration tree', () => {
  const all = loadMigrations();
  const real = realDatabaseNames(readFileSync(WRANGLER, 'utf8'));

  test('every migration loads and is classified', () => {
    assert.ok(all.length >= 49, `only loaded ${all.length}`);
    const kinds = {};
    for (const m of all) kinds[m.kind] = (kinds[m.kind] || 0) + 1;
    // Nothing may be 'unrouted' — that is #360's guard, restated where the runner
    // would trip over it.
    assert.equal(kinds.unrouted, undefined, 'a migration names no database');
    assert.equal(kinds['multi-db'], 2, 'the two known multi-database files');
    assert.equal(kinds.inert, 6, 'the six recipes that apply nothing');
  });

  test('apply order is folder then filename, and it is the intended order', () => {
    const order = all.map((m) => `${m.folder}/${m.filename}`);
    assert.deepEqual(order, [...order].sort(), 'load order must already be sorted');
    // The ordering that matters in practice: the ledger comes after the migrations
    // whose history it will record, and 34/35/36 come after the detection in 07/08/10.
    const at = (f) => order.findIndex((x) => x.endsWith(f));
    assert.ok(at('07-core-id-uniqueness.sql') < at('34-core-unique-id-code.sql'));
    assert.ok(at('09-error-log-client-ip.sql') < at('33-scrub-visitor-ips.sql'));
  });

  test('every runnable migration targets a database that exists', () => {
    for (const m of all) {
      for (const db of m.databases) {
        assert.ok(real.includes(db), `${m.filename} targets "${db}", which is not in wrangler.toml`);
      }
    }
  });

  test('an inert recipe is never queued, in any database', () => {
    // Recording one would claim something happened. Applying one is a no-op that
    // would still write a ledger row saying otherwise.
    const inert = all.filter((m) => m.kind === 'inert').map((m) => m.filename);
    assert.ok(inert.length > 0);
    for (const db of real) {
      const queued = plan(all, db, []).pending.map((m) => m.filename);
      for (const f of inert) assert.ok(!queued.includes(f), `${f} was queued for ${db}`);
    }
  });

  test('the ledger migration is itself queued, so its own history is recorded', () => {
    // It targets chhath-core in its "Apply with" example; the tool bootstraps it into
    // every database separately. What matters is that it is not classified inert.
    const led = all.find((m) => m.filename === LEDGER_FILE);
    assert.ok(led, `${LEDGER_FILE} not found under ${MIGRATION_ROOT}`);
    assert.equal(led.kind, 'runnable');
    assert.match(led.sql, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  });

  test('a full adopt leaves nothing pending and nothing changed', () => {
    // The first run on an existing deployment: 40+ migrations already applied by hand.
    // Adopting them must produce a clean ledger, or the tool is unusable there.
    for (const db of real) {
      const first = plan(all, db, []);
      const rows = first.pending.map((m) => ({ filename: m.filename, checksum: m.checksum }));
      const second = plan(all, db, rows);
      assert.deepEqual(second.pending, [], `${db} still has pending after adopt`);
      assert.deepEqual(second.changed, [], `${db} reports a checksum change after adopt`);
      assert.deepEqual(second.orphaned, [], `${db} reports orphans after adopt`);
    }
  });
});

describe('the small pure pieces', () => {
  test('checksum is stable and notices a one-character edit', () => {
    assert.equal(checksum('a'), checksum('a'));
    assert.notEqual(checksum('SELECT 1;'), checksum('SELECT 2;'));
    assert.match(checksum('x'), /^[0-9a-f]{64}$/);
    // A comment-only edit must also change it — that is the point.
    assert.notEqual(checksum('-- note\nSELECT 1;'), checksum('-- other\nSELECT 1;'));
  });

  test('executable vs comment-only', () => {
    assert.equal(hasExecutableSql('-- just a comment\n\n--another\n'), false);
    assert.equal(hasExecutableSql('-- c\nSELECT 1;\n'), true);
    assert.equal(hasExecutableSql('   \n\t\n'), false);
  });

  test('all three ways a migration names its database are read', () => {
    assert.deepEqual(declaredDatabases('--  wrangler d1 execute chhath-core --remote'), ['chhath-core']);
    assert.deepEqual(declaredDatabases('--   Section A -> chhath-logs'), ['chhath-logs']);
    assert.deepEqual(declaredDatabases('-- Section B — DB: chhath-misc'), ['chhath-misc']);
    // De-duplicated: the same database named in the summary and in a section header is
    // one target, not two, or every multi-DB file would look worse than it is.
    assert.deepEqual(
      declaredDatabases('-- Section A -> chhath-core\n-- Section A — DB: chhath-core'),
      ['chhath-core']
    );
  });

  test("wrangler's --json output is read in either shape it comes in", () => {
    // The shape has moved between wrangler versions; both are accepted, and anything
    // unparseable is an empty ledger rather than a crash.
    assert.deepEqual(parseRows('[{"results":[{"filename":"a.sql"}]}]'), [{ filename: 'a.sql' }]);
    assert.deepEqual(parseRows('{"results":[{"filename":"b.sql"}]}'), [{ filename: 'b.sql' }]);
    assert.deepEqual(parseRows('[{"rows":[{"filename":"c.sql"}]}]'), [{ filename: 'c.sql' }]);
    assert.deepEqual(parseRows('not json at all'), []);
    assert.deepEqual(parseRows('[]'), []);
  });
});
