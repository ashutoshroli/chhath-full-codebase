#!/usr/bin/env node
// ============================================================================
// Wave C — the DB rebuild + seed runner
//
// WHAT PROBLEM THIS SOLVES. The nine schema/*.sql files build a clean, complete
// set of 54 tables in a fresh database — and NOT ONE SEED ROW. Every seed lives
// in a migration OUTSIDE schema/:
//
//   28-journey-content.sql          12 rows (the 10 year cards + 2 tagline settings)
//   29-journey-page-text.sql         2 rows (the two journey-page JSON blobs)
//   30-donation-settings.sql         7 rows (the donate page's bank / UPI / QR keys)
//   32-consent-decline-templates.sql 6 rows (declined/rejected notify templates — #349)
//
// So a database built from schema/ alone launches HALF-EMPTY: the donate page has
// no bank or UPI details to show, and a declined consent notifies NOBODY, because
// the templates respondConsent() looks up simply are not there. #367 claimed
// DEPLOY_GUIDE.md documented a rebuild; it did not. This is that procedure, made
// runnable and proven by rebuild-and-seed.test.mjs.
//
// DESIGN — SAME AS migrate.mjs: THE LOGIC IS PURE, THE DATABASE IS ONE INJECTED
// FUNCTION. Everything that decides anything — which schema file backs which
// database, which seed migrations to apply and in what order — is a pure function
// over strings, and is tested. The only impure part is `exec`, which is passed in.
// migrate.mjs cannot reach a real D1 from where it was written and neither can
// this; the CLI wires `exec` to `wrangler d1 execute`, and the test wires it to a
// node:sqlite database, so the SAME ordering logic is what both run.
//
// The seed migrations are reused verbatim through loadMigrations() rather than
// re-parsed here: their order, target database and checksum all come from the one
// reader migrate.mjs already tests.
//
// NON-DESTRUCTIVE + IDEMPOTENT. Every seed migration guards each INSERT with
// WHERE NOT EXISTS (verified by reading them), so applying them twice adds nothing
// and never overwrites a value an admin has since edited. The schema apply,
// however, is for a FRESH database: the schema files are plain CREATE TABLE (no
// IF NOT EXISTS), so `--schema` must only ever run against an empty database.
//
// COMMANDS
//   plan  [--db X]                 print the ordered file list, change nothing
//   seed  --db X                   apply ONLY the seed migrations for database X
//   full  --db X                   apply the schema for X, then its seed migrations
//
//   --local        use the local D1 copy instead of --remote
//   --dry-run      print what would run, change nothing
//
// Usage:
//   node mgmt/db/rebuild.mjs plan
//   node mgmt/db/rebuild.mjs full --db chhath-core --local
//   node mgmt/db/rebuild.mjs seed --db chhath-loans-expenses --remote
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadMigrations, MIGRATION_ROOT } from './migrate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_ROOT = join(HERE, 'schema');

// The seed migrations, by filename, in apply order. These four are the ONLY
// migrations under mgmt/db/migration that seed rows the schema does not carry.
// Naming them here (rather than sniffing for INSERTs) is deliberate: it is the
// list the CI 'every migration is covered by a test' guard and the rebuild test
// both pin, so adding a seed migration is a conscious edit in one place.
export const SEED_MIGRATIONS = [
  '28-journey-content.sql',
  '29-journey-page-text.sql',
  '30-donation-settings.sql',
  '32-consent-decline-templates.sql',
];

// Which committed schema file backs which real D1 database. Mirrors SCHEMA_BY_DB
// in migration-matrix.test.mjs — the schema files ARE the per-database end state.
export const SCHEMA_BY_DB = {
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

// ---------------------------------------------------------------- pure helpers

/** Every schema/*.sql file, sorted — the fresh-database build set. */
export function schemaFiles(root = SCHEMA_ROOT, list = (p) => readdirSync(p)) {
  return list(root).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * The seed migrations that target `db`, as { folder, filename, sql, database }
 * records in SEED_MIGRATIONS order. Reuses migrate.mjs's loadMigrations so the
 * target database and apply order are the SAME logic the ledger runner uses,
 * never re-derived here.
 *
 * Throws if a name in SEED_MIGRATIONS is not found on disk — a seed migration
 * that was renamed or deleted must fail loudly, not be silently skipped (the same
 * failure mode migrate.mjs exists to remove).
 */
export function seedMigrationsFor(db, migrations = loadMigrations()) {
  const byName = new Map(migrations.map((m) => [m.filename, m]));
  const chosen = [];
  for (const name of SEED_MIGRATIONS) {
    const m = byName.get(name);
    if (!m) throw new Error(`seed migration ${name} not found under ${MIGRATION_ROOT}`);
    if (m.database === db) chosen.push(m);
  }
  return chosen;
}

/**
 * The full ordered rebuild plan for one database: the schema file (if that
 * database has one), then its seed migrations. Pure — returns a description, runs
 * nothing.
 */
export function rebuildPlan(db, opts = {}) {
  const migrations = opts.migrations || loadMigrations();
  const files = opts.schemaFiles || schemaFiles();
  const schema = SCHEMA_BY_DB[db];
  if (!schema) throw new Error(`no schema mapped for database "${db}"`);
  if (!files.includes(schema)) throw new Error(`schema file ${schema} not found under ${SCHEMA_ROOT}`);
  return {
    db,
    schema,
    seeds: seedMigrationsFor(db, migrations).map((m) => ({ folder: m.folder, filename: m.filename })),
  };
}

/** Every database in SCHEMA_BY_DB that has at least one seed migration. */
export function seededDatabases(migrations = loadMigrations()) {
  return Object.keys(SCHEMA_BY_DB).filter((db) => seedMigrationsFor(db, migrations).length > 0);
}

// ---------------------------------------------------------- the rebuild engine

/**
 * Apply a rebuild to one database through an injected `exec`. `exec.schema(sql)`
 * runs the schema DDL and `exec.seed(sql)` runs one seed migration; both are the
 * only impure calls. `mode` is 'full' (schema then seeds) or 'seed' (seeds only).
 *
 * Returns the ordered list of steps taken, so the caller (CLI or test) can report
 * exactly what ran.
 */
export function runRebuild(db, exec, { mode = 'full', migrations, read = (p) => readFileSync(p, 'utf8') } = {}) {
  const plan = rebuildPlan(db, { migrations });
  const steps = [];
  if (mode === 'full') {
    exec.schema(read(join(SCHEMA_ROOT, plan.schema)));
    steps.push({ step: 'schema', file: plan.schema });
  }
  const seeds = seedMigrationsFor(db, migrations);
  for (const m of seeds) {
    exec.seed(read(join(MIGRATION_ROOT, m.folder, m.filename)));
    steps.push({ step: 'seed', file: m.filename });
  }
  return { db, mode, steps };
}

// ------------------------------------------------------------------- the shell

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeExec(db, remote, dryRun) {
  const flag = remote ? '--remote' : '--local';
  const run = (sql, label) => {
    if (dryRun) { process.stdout.write(`  would apply ${label} (${sql.length} bytes)\n`); return; }
    wrangler(['d1', 'execute', db, flag, '--command', sql]);
  };
  return {
    schema: (sql) => run(sql, 'schema'),
    seed: (sql) => run(sql, 'seed'),
  };
}

// ------------------------------------------------------------------------ main

const HELP = `rebuild.mjs — build a database from schema/ and seed it

  plan  [--db <name>]  print the ordered schema+seed file list (reads nothing live)
  seed  --db <name>    apply ONLY the seed migrations for that database
  full  --db <name>    apply the schema for that database, THEN its seed migrations

  --local     use the local D1 copy instead of --remote
  --remote    use the remote (live) D1 — required for a real rebuild
  --dry-run   print what would run, change nothing

WARNING: 'full' applies plain CREATE TABLE schema DDL, so run it only against a
FRESH (empty) database. 'seed' is idempotent (every INSERT is WHERE NOT EXISTS)
and safe to re-run. A database built from schema/ WITHOUT the seeds launches
half-empty: no donate bank/UPI details, and a declined consent notifies nobody.
`;

function main(argv) {
  const cmd = argv[0];
  const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
  const has = (n) => argv.includes(n);
  if (!cmd || has('--help') || !['plan', 'seed', 'full'].includes(cmd)) {
    process.stdout.write(HELP);
    return cmd && !has('--help') ? 1 : 0;
  }
  const only = flag('--db');

  if (cmd === 'plan') {
    const dbs = only ? [only] : seededDatabases();
    for (const db of dbs) {
      const p = rebuildPlan(db);
      process.stdout.write(`\n${db}:\n  schema: ${p.schema}\n`);
      for (const s of p.seeds) process.stdout.write(`  seed:   ${s.filename}\n`);
    }
    return 0;
  }

  if (!only) { process.stderr.write(`${cmd} needs --db <name>\n`); return 1; }
  if (!SCHEMA_BY_DB[only]) {
    process.stderr.write(`Unknown database "${only}". Known: ${Object.keys(SCHEMA_BY_DB).join(', ')}\n`);
    return 1;
  }
  const remote = has('--remote') || !has('--local');
  const dryRun = has('--dry-run');
  process.stdout.write(`\n${only}: ${cmd} (${remote ? 'remote' : 'local'})${dryRun ? ' [dry-run]' : ''}\n`);
  const result = runRebuild(only, makeExec(only, remote, dryRun), { mode: cmd });
  for (const s of result.steps) process.stdout.write(`  ${s.step}: ${s.file}\n`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('rebuild.mjs')) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`${e.stderr || e.message}\n`);
    process.exit(1);
  }
}
