#!/usr/bin/env node
// ============================================================================
// PR-35 — the migration runner
//
// WHAT PROBLEM THIS SOLVES. Until now, applying a migration meant reading a comment
// inside the file, copying a `wrangler d1 execute` line, and remembering afterwards
// that you had done it. Nothing recorded the result. Consequences, all of which
// actually happened:
//
//   * nobody could say which migrations were applied — not the operator, not CI;
//   * a command that FAILED (five files named a database that does not exist, #360)
//     was reported as run, because a failed apply and a successful one look the same
//     in a checklist;
//   * a file edited after being applied was undetectable.
//
// DESIGN: THE LOGIC IS PURE, THE DATABASE IS ONE INJECTED FUNCTION.
//
// Everything that decides anything — which migrations exist, which are pending, what
// order they go in, which database each targets, whether a checksum still matches — is
// a pure function over strings, and is tested. The only impure part is `exec`, which
// shells out to wrangler, and it is passed in. That is deliberate: I cannot reach a
// real D1 database from where this was written, so the alternative would have been
// shipping untested branching around an untestable call.
//
// COMMANDS
//
//   status            what is applied, what is pending, per database. Reads only.
//   apply [--db X]    apply pending migrations in order, recording each one.
//   verify            re-checksum applied migrations; report any file that changed.
//   adopt [--db X]    record pending migrations as applied WITHOUT running them.
//
// `adopt` is not a convenience, it is the only way this is usable at all. There are 40+
// migrations already applied to the live databases by hand. Without `adopt`, `apply`
// would try to re-run all of them: most are idempotent and would be harmless, some
// (ADD COLUMN) would fail, and one (33) would be a no-op only by luck. So the first
// run on an existing deployment is `adopt`, which writes the history without touching
// the schema — and it prints exactly what it is about to claim, so a wrong claim is
// visible before it is made.
//
// Nothing here is destructive. `apply` runs migration files, which the migration tests
// already prove are additive or idempotent; `adopt` and `status` do not run them at
// all; `verify` only reads.
//
// Usage:
//   node mgmt/db/migrate.mjs status
//   node mgmt/db/migrate.mjs adopt --db chhath-core --dry-run
//   node mgmt/db/migrate.mjs apply --db chhath-core
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATION_ROOT = join(HERE, 'migration');
const WRANGLER_TOML = resolve(HERE, '..', 'backend', 'wrangler.toml');

export const LEDGER_FILE = '37-schema-migrations-ledger.sql';

// ---------------------------------------------------------------- pure helpers

export function checksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** True when the file contains a statement that would actually run. */
export function hasExecutableSql(sql) {
  return sql.split('\n').some((l) => l.trim() !== '' && !l.trim().startsWith('--'));
}

/**
 * Databases a migration declares, in any of the three forms in use. Same reader as
 * migration-target-databases.test.mjs, for the same reason: the two multi-database
 * files name their targets only in the section forms.
 */
export function declaredDatabases(sql) {
  const names = [
    ...sql.matchAll(/wrangler\s+d1\s+execute\s+([A-Za-z0-9_-]+)/g),
    ...sql.matchAll(/Section\s+[A-Z]\s*(?:->|—\s*DB:)\s*([A-Za-z0-9_-]+)/g),
  ].map((m) => m[1]);
  return [...new Set(names)];
}

/** Real D1 database names — wrangler.toml is the only place they are real. */
export function realDatabaseNames(toml) {
  return [...toml.matchAll(/^\s*database_name\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/**
 * Every migration on disk, in apply order (folder then filename — both are numbered
 * so a lexical sort IS the intended order), classified.
 *
 * `kind` is one of:
 *   'runnable'   exactly one target database; the tool can apply it
 *   'inert'      no executable SQL — a rebuild/detection recipe. Never applied, and
 *                never recorded, because recording it would claim something happened.
 *   'multi-db'   several target databases. REFUSED, not guessed at: these apply
 *                section-by-section against different databases, and running the whole
 *                file fails part-way through (#353). The tool says so and stops.
 *   'unrouted'   executable but names no database. Cannot happen while
 *                migration-target-databases.test.mjs passes; handled rather than
 *                assumed, because a runner that silently skips a migration is worse
 *                than one that refuses to start.
 */
export function loadMigrations(root = MIGRATION_ROOT, read = (p) => readFileSync(p, 'utf8')) {
  const out = [];
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const folder of folders) {
    const files = readdirSync(join(root, folder)).filter((f) => f.endsWith('.sql')).sort();
    for (const filename of files) {
      const sql = read(join(root, folder, filename));
      const dbs = declaredDatabases(sql);
      let kind;
      if (!hasExecutableSql(sql)) kind = 'inert';
      else if (dbs.length === 0) kind = 'unrouted';
      else if (dbs.length > 1) kind = 'multi-db';
      else kind = 'runnable';
      out.push({ folder, filename, sql, databases: dbs, database: dbs.length === 1 ? dbs[0] : null, kind, checksum: checksum(sql) });
    }
  }
  return out;
}

/**
 * Compare disk against one database's ledger rows.
 *
 * The ledger is per-database, so only migrations targeting THIS database are
 * considered — a migration for another database is not "pending" here.
 */
export function plan(migrations, db, ledgerRows) {
  const applied = new Map(ledgerRows.map((r) => [r.filename, r]));
  const mine = migrations.filter((m) =>
    m.database === db ||
    (m.databases.length > 1 && m.databases.includes(db)) ||
    // An unrouted migration has no known target, so it is surfaced in EVERY database
    // rather than none. Filtering on `database === db` quietly dropped these
    // altogether — a runner silently skipping a migration is the failure this whole
    // tool exists to remove, so it must not be able to happen here either.
    m.kind === 'unrouted'
  );

  const pending = [];
  const done = [];
  const changed = [];
  const blocked = [];
  const inert = [];

  for (const m of mine) {
    const row = applied.get(m.filename);
    if (row) {
      done.push(m);
      // A file that no longer matches what was applied. Reported, never auto-fixed:
      // the right response depends on whether the edit was cosmetic or not, and only a
      // human can tell.
      if (row.checksum !== m.checksum) changed.push({ ...m, appliedChecksum: row.checksum });
      continue;
    }
    // A recipe applies nothing, so it is never queued and never recorded. Running one
    // is a harmless no-op, but the ledger row it would leave behind would claim
    // something happened — and a ledger that overstates is worse than none.
    if (m.kind === 'inert') { inert.push(m); continue; }
    if (m.kind === 'multi-db' || m.kind === 'unrouted') { blocked.push(m); continue; }
    pending.push(m);
  }

  // A ledger row is orphaned only when the file exists NOWHERE — compared against the
  // whole tree, not just this database's share, or a migration moved between databases
  // would be reported as deleted.
  const orphaned = ledgerRows.filter((r) => !migrations.some((m) => m.filename === r.filename));

  return { db, pending, done, changed, blocked, inert, orphaned };
}

/** The ledger must exist before it can be read; this is the one bootstrap step. */
export function ledgerSql(root = MIGRATION_ROOT) {
  const all = loadMigrations(root);
  const led = all.find((m) => m.filename === LEDGER_FILE);
  if (!led) throw new Error(`${LEDGER_FILE} not found under ${root}`);
  return led.sql;
}

/** SQL that records one migration as applied. Values are escaped, not bound: this is
 *  handed to `wrangler d1 execute --command`, which takes no parameters. */
export function recordSql(m, appliedBy, now = new Date().toISOString()) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return (
    'INSERT INTO schema_migrations (folder, filename, checksum, applied_at, applied_by) ' +
    `VALUES (${q(m.folder)}, ${q(m.filename)}, ${q(m.checksum)}, ${q(now)}, ${q(appliedBy)});`
  );
}

// ------------------------------------------------------------------- the shell

/** The one impure function. Everything else is a pure function over strings. */
function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeExec(remote = true) {
  return {
    command(db, sql) {
      return wrangler(['d1', 'execute', db, ...(remote ? ['--remote'] : ['--local']), '--json', '--command', sql]);
    },
    file(db, path) {
      return wrangler(['d1', 'execute', db, ...(remote ? ['--remote'] : ['--local']), '--json', '--file', path]);
    },
  };
}

/** Rows out of `wrangler d1 execute --json`, whose shape has moved between versions. */
export function parseRows(stdout) {
  let data;
  try { data = JSON.parse(stdout); } catch { return []; }
  const first = Array.isArray(data) ? data[0] : data;
  if (!first) return [];
  return first.results || first.rows || [];
}

async function readLedger(exec, db) {
  try {
    return parseRows(exec.command(db, 'SELECT folder, filename, checksum, applied_at, applied_by FROM schema_migrations;'));
  } catch (e) {
    // No ledger yet is the normal state on first run, not an error.
    if (/no such table/i.test(e.stderr || e.message || '')) return null;
    throw e;
  }
}

// ------------------------------------------------------------------------ main

const HELP = `migrate.mjs — the migration ledger and runner

  status              what is applied and what is pending, per database (reads only)
  apply  --db <name>  apply pending migrations in order, recording each
  adopt  --db <name>  record pending migrations as applied WITHOUT running them
  verify              re-checksum applied migrations; report files that changed

  --dry-run           print what would happen, change nothing
  --local             use the local D1 copy instead of --remote
  --by <who>          value for applied_by (default: $USER or 'operator')
`;

async function main(argv) {
  const cmd = argv[0];
  const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
  const has = (n) => argv.includes(n);
  if (!cmd || has('--help') || !['status', 'apply', 'adopt', 'verify'].includes(cmd)) {
    process.stdout.write(HELP);
    return cmd && !has('--help') ? 1 : 0;
  }

  const dryRun = has('--dry-run');
  const exec = makeExec(!has('--local'));
  const by = flag('--by') || process.env.USER || 'operator';
  const migrations = loadMigrations();
  const real = realDatabaseNames(readFileSync(WRANGLER_TOML, 'utf8'));
  const only = flag('--db');
  if (only && !real.includes(only)) {
    process.stderr.write(`Unknown database "${only}". Real names: ${real.join(', ')}\n`);
    return 1;
  }
  const targets = only ? [only] : real;

  let exit = 0;
  for (const db of targets) {
    const rows = await readLedger(exec, db);
    if (rows === null) {
      process.stdout.write(`\n${db}: no ledger yet.\n`);
      if (cmd === 'status' || cmd === 'verify') { exit = 1; continue; }
      if (dryRun) { process.stdout.write(`  would create it from ${LEDGER_FILE}\n`); continue; }
      exec.file(db, join(MIGRATION_ROOT, '2026-09-05', LEDGER_FILE));
      process.stdout.write('  ledger created.\n');
    }
    const p = plan(migrations, db, rows || []);
    process.stdout.write(`\n${db}: ${p.done.length} applied, ${p.pending.length} pending`);
    if (p.inert.length) process.stdout.write(`, ${p.inert.length} recipes (apply nothing)`);
    process.stdout.write(p.blocked.length ? `, ${p.blocked.length} need manual handling\n` : '\n');

    for (const c of p.changed) {
      process.stdout.write(`  CHANGED SINCE APPLIED  ${c.filename}\n    applied ${c.appliedChecksum.slice(0, 12)}  on disk ${c.checksum.slice(0, 12)}\n`);
      exit = 1;
    }
    for (const o of p.orphaned) {
      process.stdout.write(`  IN LEDGER BUT NOT ON DISK  ${o.filename}\n`);
      exit = 1;
    }
    for (const b of p.blocked) {
      process.stdout.write(`  MANUAL  ${b.filename}  (${b.kind === 'multi-db' ? `spans ${b.databases.join(', ')} — apply section by section` : 'names no database'})\n`);
    }
    if (cmd === 'status' || cmd === 'verify') {
      for (const m of p.pending) process.stdout.write(`  PENDING  ${m.filename}\n`);
      continue;
    }

    for (const m of p.pending) {
      const what = cmd === 'apply' ? 'apply' : 'record as already applied';
      if (dryRun) { process.stdout.write(`  would ${what}: ${m.filename}\n`); continue; }
      if (cmd === 'apply') exec.file(db, join(MIGRATION_ROOT, m.folder, m.filename));
      exec.command(db, recordSql(m, cmd === 'adopt' ? 'adopt' : by));
      process.stdout.write(`  ${cmd === 'apply' ? 'applied' : 'adopted'}: ${m.filename}\n`);
    }
  }
  return exit;
}

if (process.argv[1] && process.argv[1].endsWith('migrate.mjs')) {
  main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => {
    process.stderr.write(`${e.stderr || e.message}\n`);
    process.exit(1);
  });
}
