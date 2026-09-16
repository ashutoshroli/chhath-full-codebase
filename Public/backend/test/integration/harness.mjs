// ============ THE PUBLIC WORKER, RUNNING FOR REAL ============
//
// audit PUB-BE-08 (no local harness). The unit suites in `test/` import `src/index.js`
// and stub D1, KV and the Cache API with plain objects. That is fast, needs no install,
// and is why this Worker got its first tests at all — but a stub only ever behaves the
// way the person who wrote it expected, so a whole class of defect is invisible to it:
//
//   * The Cache API refuses to store a response with no freshness information. A stub
//     that keeps everything in a Map cannot tell you that; workerd can.
//   * The Cache API refuses a non-GET key. The unit stub asserts this by hand because
//     someone remembered to.
//   * D1 errors have real shapes and real messages, and the SQL is validated against the
//     COMMITTED schema rather than against a fixture that agrees with the code.
//   * `caches.default`, `ctx.waitUntil`, request/response immutability, `Content-Length`,
//     preflight handling and status-code semantics are the platform's, not ours.
//
// So this harness boots the real Worker under workerd, on real D1 (each database created
// from `mgmt/db/schema/*.sql` — the same committed DDL the mgmt suite runs against, so
// drift between the code and the schema fails here), real KV and the real Cache API.
//
// It complements the unit suites rather than replacing them: they pin the specific
// findings W2 fixed, cheaply and in isolation. This one answers "does the thing actually
// work when the platform is the platform".

import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';

const SCHEMA_DIR = new URL('../../../../mgmt/db/schema/', import.meta.url);
const WORKER_SRC = new URL('../../src/index.js', import.meta.url);

// Which schema file backs which binding, exactly as wrangler.toml binds them.
const BINDINGS = {
  DB_CORE: 'core.sql',
  DB_COLLECTIONS: 'collections.sql',
  DB_LOANS_EXPENSES: 'loans_expenses.sql',
  DB_FILE_INDEX: 'file_index.sql',
  DB_MISC: 'misc.sql',
  DB_LOGS: 'logs.sql',
};

/**
 * D1's `exec()` splits on newlines and chokes on comments, and the committed schema files
 * are full of both — they are documentation as much as DDL. So the statements are split
 * here and run one at a time, which also means a failure names the statement that failed.
 */
function statementsOf(sql) {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function startWorker({ vars = {}, seed = null } = {}) {
  const mf = new Miniflare({
    modules: true,
    modulesRoot: new URL('../../', import.meta.url).pathname,
    scriptPath: WORKER_SRC.pathname,
    compatibilityDate: '2025-01-01',
    d1Databases: Object.keys(BINDINGS),
    kvNamespaces: ['KV_PUBLIC'],
    cache: true,
    bindings: vars,
  });

  // Wait for workerd before touching a binding, so a boot failure is reported as one.
  await mf.ready;

  const dbs = {};
  for (const [binding, file] of Object.entries(BINDINGS)) {
    const db = await mf.getD1Database(binding);
    dbs[binding] = db;
    const sql = readFileSync(new URL(file, SCHEMA_DIR), 'utf8');
    for (const stmt of statementsOf(sql)) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        // A schema file may carry statements for objects another file owns; anything else
        // is real drift and must be loud.
        if (!/already exists|no such table/i.test((e && e.message) || '')) {
          throw new Error(`${file}: ${(e && e.message) || e}\n  in: ${stmt.slice(0, 160)}`);
        }
      }
    }
  }

  const kv = await mf.getKVNamespace('KV_PUBLIC');
  if (seed) await seed({ dbs, kv });

  return {
    mf,
    dbs,
    kv,
    /** A request against the Worker. Returns the real Response workerd produced. */
    fetch: (query = '', init = {}) => mf.dispatchFetch(`https://public.test/${query}`, init),
    dispose: () => mf.dispose(),
  };
}

/** The smallest set of rows that makes every action answer with something real. */
export async function seedPortal({ dbs }, { version = '7' } = {}) {
  const core = dbs.DB_CORE;
  await core.prepare('INSERT INTO portal_settings ("key", value) VALUES (?, ?)')
    .bind('public_data_version', version).run();
  await core.prepare('INSERT INTO portal_settings ("key", value) VALUES (?, ?)')
    .bind('seo_public_title', 'Chhath Puja Samiti').run();
  await core.prepare(
    'INSERT INTO users (id_code, name, village, fathers_name, mobile, designation, created_by, email, whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind('USER0007', 'Amit Kumar', 'Baragaon', 'Ram Kumar', '9876543210', 'Member', 'superadmin', 'amit@example.com', '9876543210').run();
  await core.prepare('INSERT INTO committee_members (year, name, created_by, view_role) VALUES (?, ?, ?, ?)')
    .bind(2026, 'USER0007', 'superadmin', 'Treasurer').run();

  await dbs.DB_COLLECTIONS.prepare(
    'INSERT INTO collections (year, sl_no, name, amount, created_by, contribution_type, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(2026, 1, 'USER0007', 501, 'superadmin', '1', 'Cash').run();

  await dbs.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO expenses (year, discription, amount, created_by, category) VALUES (?, ?, ?, ?, ?)'
  ).bind(2026, 'Tent', 1200, 'superadmin', 'Setup').run();
}
