// audit PR-35 (precondition) — a migration must name a database that EXISTS.
//
// THE BUG THIS EXISTS BECAUSE OF, which I wrote myself.
//
// Every migration carries an "Apply with:" line that an operator copy-pastes:
//
//     wrangler d1 execute chhath-logs --remote --file=./33-scrub-visitor-ips.sql
//
// Five of them named a database that does not exist — `chhath_logs`, `chhath_core`,
// `chhath_collections`, `chhath_loans_expenses`, with UNDERSCORES, while every real
// database in wrangler.toml uses HYPHENS. Four were pre-existing; the fifth
// (33-scrub-visitor-ips) I introduced in #356 by copying the header of migration 09,
// and then repeated in the runbook, so the operator was handed a command that could
// only fail. A privacy remediation looked applied and may not have been.
//
// Nothing could have caught it. The SQL is valid, the file is registered in the
// migration matrix, every test passed — because no test ever read the one line a human
// actually acts on. The instruction was not code, so it was not checked.
//
// It is now. Two rules, both derived from the tree rather than from a list I keep in
// step by hand:
//
//   1. the database a migration names must appear as a `database_name` in
//      mgmt/backend/wrangler.toml — the only place D1 names are real;
//   2. a migration that HAS executable SQL must name one at all. A comment-only
//      recipe (11, 12, 13) legitimately does not, because it is not something you
//      run — and that exemption is derived from the file's own content, not declared,
//      so a recipe that later grows real statements stops being exempt by itself.
//
// Run: node --test mgmt/backend/test/migration-target-databases.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATION_ROOT = new URL('../../db/migration/', import.meta.url);
const WRANGLER = new URL('../wrangler.toml', import.meta.url);

/** Every real D1 database name, from the only file where they are real. */
function realDatabaseNames() {
  const toml = readFileSync(WRANGLER, 'utf8');
  const names = [...toml.matchAll(/^\s*database_name\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  return new Set(names);
}

/** [{ folder, file, rel, sql }] for every migration, in apply order. */
function migrations() {
  const out = [];
  for (const folder of readdirSync(MIGRATION_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const dir = new URL(`${folder}/`, MIGRATION_ROOT);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      out.push({ folder, file, rel: `${folder}/${file}`, sql: readFileSync(new URL(file, dir), 'utf8') });
    }
  }
  return out;
}

/** True when the file contains at least one statement that would actually run. */
function hasExecutableSql(sql) {
  return sql.split('\n').some((line) => line.trim() !== '' && !line.trim().startsWith('--'));
}

/**
 * Every database name a human is told to act on. THREE forms are in use, and all of
 * them have to be validated, because an operator reads whichever one is in front of
 * them — a correct "Apply with:" line does not help if a section header two lines
 * down names a database that does not exist:
 *
 *   wrangler d1 execute <db> ...        the copy-paste command
 *   --   Section A -> <db>              the summary at the top of a multi-DB file
 *   -- Section A — DB: <db>             the header on each section of one
 *
 * An earlier version of this test read only the first form, which meant it silently
 * checked nothing at all on the two multi-database files — they name their databases
 * exclusively in the other two.
 */
function declaredDatabases(sql) {
  const names = [
    ...sql.matchAll(/wrangler\s+d1\s+execute\s+([A-Za-z0-9_-]+)/g),
    ...sql.matchAll(/Section\s+[A-Z]\s*(?:->|—\s*DB:)\s*([A-Za-z0-9_-]+)/g),
  ].map((m) => m[1]);
  return names;
}

describe('every migration names a database that exists', () => {
  const real = realDatabaseNames();
  const files = migrations();

  test('the two sources are actually being read', () => {
    // If either walk came back empty every assertion below would pass vacuously.
    assert.ok(real.size >= 9, `only found ${real.size} database names in wrangler.toml`);
    assert.ok(files.length >= 45, `only found ${files.length} migrations`);
    // The name that started this: hyphens are real, underscores are not.
    assert.ok(real.has('chhath-logs'), 'expected chhath-logs to be a real database');
    assert.ok(!real.has('chhath_logs'), 'chhath_logs must NOT be a real database name');
  });

  test('no migration names a database that does not exist', () => {
    const bad = [];
    for (const m of files) {
      for (const db of declaredDatabases(m.sql)) {
        if (!real.has(db)) bad.push(`${m.rel} -> "${db}"`);
      }
    }
    assert.deepEqual(
      bad, [],
      'these migrations tell an operator to run against a database that is not in ' +
      `wrangler.toml (real names: ${[...real].sort().join(', ')}):\n  ${bad.join('\n  ')}`
    );
  });

  test('a migration with executable SQL says where to apply it', () => {
    const silent = [];
    for (const m of files) {
      if (!hasExecutableSql(m.sql)) continue; // a recipe is not something you run
      if (declaredDatabases(m.sql).length === 0) silent.push(m.rel);
    }
    assert.deepEqual(
      silent, [],
      'these migrations do something but never say to which database:\n  ' + silent.join('\n  ')
    );
  });

  test('the set of files that apply nothing is pinned', () => {
    // These six are rebuild/detection RECIPES that apply nothing by design — 10's FK
    // rebuild, 11's CHECKs, 12/13's REAL->INTEGER and ->TEXT, and 18/19's documented
    // column additions. Pinning the set means a migration that quietly becomes a
    // no-op — or a recipe that quietly grows real statements — shows up here.
    const inert = files.filter((m) => !hasExecutableSql(m.sql)).map((m) => m.rel).sort();
    assert.deepEqual(inert, [
      '2026-09-05/10-loans-referential-integrity.sql',
      '2026-09-05/11-domain-check-constraints.sql',
      '2026-09-05/12-column-types-integer.sql',
      '2026-09-05/13-column-types-text.sql',
      '2026-09-05/18-official-emails-attachments.sql',
      '2026-09-05/19-popup-slide-duration.sql',
    ]);
  });

  test('the multi-database files are known, and they are the only ones', () => {
    // A file naming several databases cannot be applied as one command — the hazard
    // #353 documented: a CREATE INDEX for a table in another database FAILS rather
    // than being skipped, so running the whole file applies the earlier sections and
    // then breaks part-way through. A NEW one must be split, or added here knowingly.
    const multi = files
      .map((m) => ({ rel: m.rel, dbs: [...new Set(declaredDatabases(m.sql))].sort() }))
      .filter((x) => x.dbs.length > 1)
      .map((x) => `${x.rel} -> ${x.dbs.join(', ')}`)
      .sort();
    assert.deepEqual(multi, [
      '2026-09-02/02-perf-indexes.sql -> chhath-collections, chhath-core, chhath-loans-expenses',
      '2026-09-02/03-scalability-indexes.sql -> chhath-collections, chhath-core, chhath-loans-expenses',
    ]);
  });
});
