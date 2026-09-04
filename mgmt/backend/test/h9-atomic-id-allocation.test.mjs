// ============ AUDIT H-9 — sequential ids were allocated read-then-write ============
//
//   const last = await d1.prepare('SELECT MAX(sl_no) ...').first();   // statement 1
//   payload['Sl. No.'] = (last.maxSl || 0) + 1;
//   await d1.prepare('INSERT INTO collections ...').run();            // statement 2
//
// D1 has no interactive transaction spanning two awaits, so two saves that
// interleave between the two statements both read the same MAX and both write the
// same id. Nothing detected it (there is no unique constraint), so the outcome was
// silent: two members sharing one USER#### — which merges their profiles, receipts
// and loan consents, since every lookup in the portal joins on id_code — or two
// contributions sharing one receipt number.
//
// The fix moves allocation INTO the INSERT, making it one atomic statement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { saveRecord } from '../src/crud.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

function makeEnv() {
  return {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
  };
}

const collectionPayload = (over = {}) => ({
  Year: 2026, Name: 'Ram Kumar', Amount: 501, 'Payment Mode': 'Cash',
  Date: '2026-10-25', 'Contribution Type': '1', ...over,
});

const allRows = async (db, sql) => (await db.prepare(sql).all()).results;

// ============================== 0. THE OLD ALGORITHM, RUN SIDE BY SIDE (the proof)

// The exact read-then-write sequence `main` used, run against the same stub, so
// the collision is demonstrated rather than asserted. Every `await` is a point at
// which the isolate can switch to another in-flight request — which is precisely
// what two volunteers pressing Save simultaneously produce.
async function allocateTheOldWay(db, year, name) {
  const row = await db.prepare('SELECT MAX(sl_no) as maxSl FROM collections WHERE year = ?')
    .bind(year).first();                                     // <-- statement 1
  const slNo = (row && row.maxSl ? row.maxSl : 0) + 1;
  await db.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?, ?, ?)')
    .bind(year, slNo, name).run();                           // <-- statement 2
  return slNo;
}

test('H-9 proof: the OLD read-then-write allocator hands the SAME id to every writer', async () => {
  const env = makeEnv();
  const handedOut = await Promise.all(
    [1, 2, 3, 4, 5].map(n => allocateTheOldWay(env.DB_COLLECTIONS, 2026, `Donor ${n}`))
  );

  // This is the bug, measured:
  assert.deepEqual(handedOut, [1, 1, 1, 1, 1],
    'all five callers were told they had Sl. No. 1');
  const stored = (await allRows(env.DB_COLLECTIONS, 'SELECT sl_no FROM collections')).map(r => r.sl_no);
  assert.deepEqual(stored, [1, 1, 1, 1, 1],
    'and five rows were written sharing one receipt number, with nothing raising an error');
  assert.equal(new Set(stored).size, 1);
});

// The same interleaving, but with allocation inside the INSERT — one atomic
// statement, so there is no window between reading MAX and writing the row.
test('H-9 proof: the NEW single-statement allocator cannot collide', async () => {
  const env = makeEnv();
  const insertAtomically = (year, name) => env.DB_COLLECTIONS.prepare(
    'INSERT INTO collections (year, name, sl_no) VALUES (?, ?, '
    + '(SELECT COALESCE(MAX(sl_no), 0) + 1 FROM collections WHERE year = ?))'
  ).bind(year, name, year).run();

  await Promise.all([1, 2, 3, 4, 5].map(n => insertAtomically(2026, `Donor ${n}`)));

  const stored = (await allRows(env.DB_COLLECTIONS, 'SELECT sl_no FROM collections ORDER BY sl_no'))
    .map(r => r.sl_no);
  assert.deepEqual(stored, [1, 2, 3, 4, 5]);
});

// =========================================== 1. THE RACE, REPRODUCED CONCURRENTLY

// `saveRecord` is async. Starting N of them WITHOUT awaiting in between is exactly
// the interleaving two volunteers pressing Save at the same moment produce: every
// call runs its reads before any of them runs its write.
//
// Against `main` this test FAILS with sl_no = [1, 1, 1, 1, 1] — five contributions
// all numbered 1.
test('H-9: five concurrent COLLECTIONS saves get five distinct Sl. No.', async () => {
  const env = makeEnv();

  const results = await Promise.all([1, 2, 3, 4, 5].map(
    n => saveRecord(env, 'COLLECTIONS', collectionPayload({ Name: `Donor ${n}` }), SUPERADMIN)
  ));

  const stored = await allRows(env.DB_COLLECTIONS, 'SELECT sl_no, name FROM collections ORDER BY sl_no');
  const slNos = stored.map(r => r.sl_no);

  assert.equal(stored.length, 5, 'all five rows must exist — none may be lost');
  assert.deepEqual(slNos, [1, 2, 3, 4, 5], `expected 1..5, got ${JSON.stringify(slNos)}`);
  assert.equal(new Set(slNos).size, 5, 'no two contributions may share a receipt number');

  // The value each caller was told matches what actually landed in the row.
  assert.deepEqual(results.map(r => r.slNo).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

// Against `main` this FAILS with id_code = [ 'USER0001' x5 ].
test('H-9: five concurrent USERS saves get five distinct USER#### ids', async () => {
  const env = makeEnv();

  const results = await Promise.all([1, 2, 3, 4, 5].map(
    n => saveRecord(env, 'USERS', { Name: `Member ${n}`, Village: 'Chhapra' }, SUPERADMIN)
  ));

  const stored = await allRows(env.DB_CORE, 'SELECT id_code, name FROM users ORDER BY id_code');
  const ids = stored.map(r => r.id_code);

  assert.deepEqual(ids, ['USER0001', 'USER0002', 'USER0003', 'USER0004', 'USER0005'],
    `expected five distinct ids, got ${JSON.stringify(ids)}`);
  assert.equal(new Set(ids).size, 5, 'two members must never share an id_code');

  // QuickAddUser.jsx does `onCreated(res.id)`, so the returned id must be the real
  // one — not the value this call *hoped* to allocate.
  assert.deepEqual(results.map(r => r.id).sort(), ids);
});

test('H-9: 50 concurrent saves still produce 50 distinct, gapless Sl. No.', async () => {
  const env = makeEnv();
  await Promise.all(Array.from({ length: 50 }, (_, i) =>
    saveRecord(env, 'COLLECTIONS', collectionPayload({ Name: `D${i}` }), SUPERADMIN)));

  const slNos = (await allRows(env.DB_COLLECTIONS, 'SELECT sl_no FROM collections ORDER BY sl_no'))
    .map(r => r.sl_no);
  assert.deepEqual(slNos, Array.from({ length: 50 }, (_, i) => i + 1));
});

// ==================================================== 2. SEMANTICS PRESERVED

test('H-9: Sl. No. is still numbered PER YEAR, not globally', async () => {
  const env = makeEnv();
  await saveRecord(env, 'COLLECTIONS', collectionPayload({ Year: 2025 }), SUPERADMIN);
  await saveRecord(env, 'COLLECTIONS', collectionPayload({ Year: 2025 }), SUPERADMIN);
  const third = await saveRecord(env, 'COLLECTIONS', collectionPayload({ Year: 2026 }), SUPERADMIN);
  const fourth = await saveRecord(env, 'COLLECTIONS', collectionPayload({ Year: 2025 }), SUPERADMIN);

  assert.equal(third.slNo, 1, '2026 starts again at 1');
  assert.equal(fourth.slNo, 3, '2025 continues from its own maximum');

  const rows = (await allRows(env.DB_COLLECTIONS, 'SELECT year, sl_no FROM collections ORDER BY id'))
    .map(r => ({ ...r })); // node:sqlite rows are null-prototype
  assert.deepEqual(rows, [
    { year: 2025, sl_no: 1 }, { year: 2025, sl_no: 2 },
    { year: 2026, sl_no: 1 }, { year: 2025, sl_no: 3 },
  ]);
});

test('H-9: allocation continues from EXISTING data, it does not restart at 1', async () => {
  const env = makeEnv();
  // Pre-existing live rows, including a gap and a year that must be ignored.
  await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?,?,?)')
    .bind(2026, 7, 'legacy a').run();
  await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?,?,?)')
    .bind(2026, 41, 'legacy b').run();
  await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?,?,?)')
    .bind(2025, 999, 'other year').run();

  const r = await saveRecord(env, 'COLLECTIONS', collectionPayload(), SUPERADMIN);
  assert.equal(r.slNo, 42, 'must be MAX(2026) + 1, ignoring 2025');

  await env.DB_CORE.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').bind('USER0123', 'legacy').run();
  const u = await saveRecord(env, 'USERS', { Name: 'New' }, SUPERADMIN);
  assert.equal(u.id, 'USER0124');
});

test('H-9: the id keeps its 4-digit zero padding, and still grows past 9999', async () => {
  const env = makeEnv();
  const first = await saveRecord(env, 'USERS', { Name: 'A' }, SUPERADMIN);
  assert.equal(first.id, 'USER0001', 'zero-padded to 4 digits, exactly as String().padStart(4, "0")');

  await env.DB_CORE.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').bind('USER9999', 'z').run();
  const past = await saveRecord(env, 'USERS', { Name: 'B' }, SUPERADMIN);
  assert.equal(past.id, 'USER10000', 'padStart does not truncate, and neither does printf %04d');
});

test('H-9: non-USER id_code rows are ignored when computing the maximum', async () => {
  const env = makeEnv();
  // Legacy/imported rows that are not in the USER#### series must not be counted,
  // or one bad row would push every future id into the millions.
  for (const bad of ['LEGACY-77', '', 'ADMIN0003']) {
    await env.DB_CORE.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').bind(bad, 'x').run();
  }
  await env.DB_CORE.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').bind('USER0004', 'y').run();

  const r = await saveRecord(env, 'USERS', { Name: 'New' }, SUPERADMIN);
  assert.equal(r.id, 'USER0005');
});

test('H-9: a client-supplied ID / Sl. No. is still ignored', async () => {
  const env = makeEnv();
  // The old code overwrote whatever the client sent. It must keep doing so —
  // otherwise a caller could plant itself on an existing member's id.
  const u = await saveRecord(env, 'USERS', { Name: 'Sneaky', ID: 'USER0001' }, SUPERADMIN);
  const c = await saveRecord(env, 'COLLECTIONS', collectionPayload({ 'Sl. No.': 9999 }), SUPERADMIN);

  assert.equal(u.id, 'USER0001', 'first real user is USER0001 by allocation, not by request');
  assert.equal(c.slNo, 1, 'the client-supplied 9999 must be discarded');
  const stored = await env.DB_COLLECTIONS.prepare('SELECT sl_no FROM collections').first('sl_no');
  assert.equal(stored, 1);
});

test('H-9 regression guard: a sheet with no generated id is untouched', async () => {
  const env = makeEnv();
  const r = await saveRecord(env, 'EXPENSES', {
    Year: 2026, Discription: 'Pandal', Amount: 12000,
  }, SUPERADMIN);

  assert.equal(r.success, true);
  assert.equal(r.id, null, 'EXPENSES has no id_code — the shape of the response is unchanged');
  assert.equal(r.slNo, undefined, 'and no slNo is invented for it');
  assert.ok(r.rowIndex > 0, 'rowIndex still comes from meta.last_row_id');
});

test('H-9: the record still stores every ordinary field, plus Created By', async () => {
  const env = makeEnv();
  await saveRecord(env, 'COLLECTIONS', collectionPayload({ Name: 'Sita Devi', Amount: 2100 }), SUPERADMIN);
  const row = await env.DB_COLLECTIONS.prepare('SELECT * FROM collections').first();
  assert.equal(row.name, 'Sita Devi');
  assert.equal(row.amount, 2100);
  assert.equal(row.payment_mode, 'Cash');
  assert.equal(row.created_by, 'USER0001', 'Created By is still stamped from the session');
  assert.equal(row.sl_no, 1);
});

// ================================================= 3. THE PAYLOAD SIDE EFFECT

test('H-9: the allocated value is put back on the payload for the activity log', async () => {
  const env = makeEnv();
  // index.js does summarizePayload(req.sheet, req.payload, res), and that helper
  // reads payload['Sl. No.'] — it only ever saw a value because the old code
  // MUTATED the payload. Deleting the key without restoring it would silently
  // strip the Sl. No. from every audit-log line.
  const payload = collectionPayload();
  const res = await saveRecord(env, 'COLLECTIONS', payload, SUPERADMIN);
  assert.equal(payload['Sl. No.'], res.slNo, 'the audit trail still records which Sl. No. was created');

  const userPayload = { Name: 'Gita' };
  const u = await saveRecord(env, 'USERS', userPayload, SUPERADMIN);
  assert.equal(userPayload.ID, u.id);
});

// =========================================== 4. STATEMENT COUNT (FREE TIER)

test('H-9: the fix costs no extra D1 statements', async () => {
  const env = makeEnv();
  let statements = 0;
  const real = env.DB_COLLECTIONS.prepare.bind(env.DB_COLLECTIONS);
  env.DB_COLLECTIONS.prepare = (sql) => { statements++; return real(sql); };

  await saveRecord(env, 'COLLECTIONS', collectionPayload(), SUPERADMIN);

  // Before: SELECT MAX(sl_no) + INSERT              = 2
  // After:  INSERT (MAX inline) + SELECT read-back  = 2
  assert.equal(statements, 2, 'the removed MAX() lookup pays for the read-back');
});

// ============================================ 5. THE MIGRATION IS SAFE + IDEMPOTENT

const MIGRATIONS = {
  '07-core-id-uniqueness.sql': { schema: 'core.sql', index: 'idx_users_id_code_seq' },
  '08-collections-sl-no-uniqueness.sql': { schema: 'collections.sql', index: 'idx_collections_year_sl_no' },
};
const migrationSql = (f) =>
  readFileSync(new URL(`../../db/migration/2026-09-05/${f}`, import.meta.url), 'utf8');

test('H-9 migration: PART 1 applies twice with no error (idempotent)', () => {
  for (const [file, { schema, index }] of Object.entries(MIGRATIONS)) {
    const sql = migrationSql(file);
    // Only PART 1 is live; PART 2 is commented out on purpose (a UNIQUE index
    // fails outright if live data already holds a duplicate — which is what the
    // pre-fix race produced).
    const live = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
    assert.match(live, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`), `${file}: PART 1 present`);
    assert.ok(!/CREATE UNIQUE INDEX/.test(live),
      `${file}: the UNIQUE variant must stay commented out until the detection query is run`);

    const db = makeD1(schemaFor(schema));
    db._db.exec(live);
    db._db.exec(live); // twice — proves IF NOT EXISTS really is there
    const idx = db._db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?").get(index);
    assert.ok(idx, `${file}: ${index} exists after applying`);
  }
});

test('H-9 migration: PART 2 UNIQUE index would now hold, and would have caught the bug', async () => {
  const env = makeEnv();
  // Apply the constraint the migration documents...
  env.DB_COLLECTIONS._db.exec(
    'CREATE UNIQUE INDEX uq_collections_year_sl_no ON collections (year, sl_no) WHERE sl_no IS NOT NULL'
  );
  // ...then hammer the fixed allocator. With the old read-then-write code this
  // threw "UNIQUE constraint failed: collections.year, collections.sl_no".
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    saveRecord(env, 'COLLECTIONS', collectionPayload({ Name: `D${i}` }), SUPERADMIN)));

  const n = await env.DB_COLLECTIONS.prepare('SELECT COUNT(*) AS n FROM collections').first('n');
  assert.equal(n, 20, 'all 20 saves succeeded under the UNIQUE constraint');
});

test('H-9 migration: the detection queries are present and runnable', () => {
  // An operator must be able to find out whether it is safe to apply PART 2.
  assert.match(migrationSql('07-core-id-uniqueness.sql'), /GROUP BY id_code[\s\S]*?HAVING COUNT\(\*\) > 1/);
  assert.match(migrationSql('08-collections-sl-no-uniqueness.sql'), /GROUP BY year, sl_no[\s\S]*?HAVING COUNT\(\*\) > 1/);

  // And they must actually execute. Strip the leading `-- ` and run them.
  const env = makeEnv();
  const dupUsers = env.DB_CORE._db.prepare(
    "SELECT id_code, COUNT(*) AS copies FROM users WHERE id_code IS NOT NULL AND id_code <> ''"
    + ' GROUP BY id_code HAVING COUNT(*) > 1'
  );
  const dupColl = env.DB_COLLECTIONS._db.prepare(
    'SELECT year, sl_no, COUNT(*) AS copies FROM collections WHERE sl_no IS NOT NULL'
    + ' GROUP BY year, sl_no HAVING COUNT(*) > 1'
  );
  assert.deepEqual(dupUsers.all(), []);
  assert.deepEqual(dupColl.all(), []);

  // Plant a duplicate and prove the query finds it.
  env.DB_CORE._db.exec("INSERT INTO users (id_code, name) VALUES ('USER0009','a'),('USER0009','b')");
  assert.deepEqual(dupUsers.all().map(r => ({ ...r })), [{ id_code: 'USER0009', copies: 2 }]);
});
