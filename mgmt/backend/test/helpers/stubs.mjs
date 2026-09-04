// ============ TEST STUBS: D1 over node:sqlite, KV over a Map ============
//
// These mimic the SHAPE of the real Cloudflare bindings closely enough to run the
// Worker's own source unmodified:
//
//   D1: env.DB.prepare(sql).bind(...).all() -> { results }
//       env.DB.prepare(sql).bind(...).first() -> row | null
//       env.DB.prepare(sql).bind(...).run()  -> { meta: { changes, last_row_id } }
//       env.DB.batch([stmt, ...])            -> one implicit transaction
//
//   KV: get / put({expirationTtl}) / delete / list({prefix, cursor})
//
// node:sqlite is the real SQLite engine, so schema mistakes, reserved-word
// columns, affinity surprises and constraint violations behave as they do on D1.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// A statement whose first keyword returns rows.
const RETURNS_ROWS = /^\s*(SELECT|WITH|PRAGMA)\b/i;
// D1 exposes RETURNING results through .first()/.all() on a write statement too.
const HAS_RETURNING = /\bRETURNING\b/i;

function toSqliteArg(v) {
  // D1 accepts booleans and coerces them; node:sqlite rejects them outright.
  if (v === true) return 1n;
  if (v === false) return 0n;
  if (v === undefined) return null;
  // FIDELITY: node:sqlite binds every JS number as a REAL (a double), so binding
  // 1 into a TEXT-affinity column stores the string "1.0". Real D1 binds an
  // integer-valued number as an INTEGER, storing "1". Several flag columns in this
  // schema are TEXT (`active`, `otp_verified`, `announced`, `reported`, ...), so
  // without this the stub would disagree with production on exactly the values
  // isTruthyFlag() exists to parse. Bind integers as BigInt to force INTEGER.
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  return v;
}

export function makeD1(schemaSql = '') {
  const db = new DatabaseSync(':memory:');
  if (schemaSql) db.exec(schemaSql);

  const prepare = (sql) => {
    let args = [];
    const stmt = {
      bind(...a) { args = a.map(toSqliteArg); return stmt; },
      async all() {
        const st = db.prepare(sql);
        if (RETURNS_ROWS.test(sql) || HAS_RETURNING.test(sql)) {
          return { results: st.all(...args), success: true, meta: {} };
        }
        const r = st.run(...args);
        return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      async first(col) {
        const st = db.prepare(sql);
        const row = st.get(...args);
        if (row === undefined || row === null) return null;
        return col === undefined ? row : row[col];
      },
      async run() {
        const st = db.prepare(sql);
        // A RETURNING write must be stepped with get()/all(), not run().
        if (HAS_RETURNING.test(sql)) {
          const rows = st.all(...args);
          return { success: true, meta: { changes: rows.length, last_row_id: 0 }, results: rows };
        }
        const r = st.run(...args);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      // Test-only introspection.
      _sql: sql,
      _args: () => args,
    };
    return stmt;
  };

  return {
    prepare,
    // D1's batch() is a single implicit transaction: all statements land or none do.
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    exec: (sql) => { db.exec(sql); },
    _db: db,
  };
}

export function makeKV() {
  const store = new Map(); // key -> { value, expiresAt (0 = never) }
  let writes = 0;
  return {
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt && Date.now() > e.expiresAt) { store.delete(key); return null; }
      return e.value;
    },
    async put(key, value, opts = {}) {
      writes++;
      store.set(key, {
        value: String(value),
        expiresAt: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0,
      });
    },
    async delete(key) { store.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
      return { keys, list_complete: true, cursor: null };
    },
    // Test-only.
    _store: store,
    _writes: () => writes,
  };
}

// Reads a schema file from mgmt/db/schema/ (so tests run against the REAL schema
// and catch drift between the code and the committed DDL).
export function schemaFor(name) {
  return readFileSync(new URL(`../../../db/schema/${name}`, import.meta.url), 'utf8');
}
