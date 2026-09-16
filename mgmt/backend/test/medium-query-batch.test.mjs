// ======== AUDIT M-12, M-13, M-15..M-23 — the Medium query/scale batch ========
//
// Every one of these reads far more rows than it needs, in a place that runs often.
// Individually they are survivable; together they are most of what would burn the
// 5,000,000-rows/day D1 budget on launch night, when the Announce screen is open on
// several phones and polling every 15 seconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { getYears } from '../src/views.js';
import { getPendingMessages, queuePersonMessageDirect } from '../src/whatsapp.js';
import { getActivePopups, savePopup, savePopupSlides } from '../src/popups.js';
import { getReceiptData } from '../src/templates.js';
import { getRecordsForDocType } from '../src/docxTemplates.js';
import { addCustomAnnouncement } from '../src/announcements.js';
import { bumpDataVersion } from '../src/dataVersion.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

// Counts D1 statements per binding so "reads fewer rows" is measured, not asserted.
function countingD1(db, counter, label) {
  const real = db.prepare.bind(db);
  return Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
    prepare(sql) {
      counter.push(`${label}: ${sql.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
      return real(sql);
    },
  });
}

function makeEnv() {
  return {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
  };
}

// ================================================== M-19: getYears, five scans

test('M-19: getYears uses SELECT DISTINCT, not five full table scans', async () => {
  const env = makeEnv();
  // 400 collection rows across 4 years, plus one year that exists only in another table.
  for (let i = 0; i < 400; i++) {
    await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name, amount) VALUES (?,?,?,?)')
      .bind(2023 + (i % 4), i + 1, `D${i}`, 100).run();
  }
  await env.DB_LOANS_EXPENSES.prepare('INSERT INTO expenses (year, discription, amount) VALUES (?,?,?)')
    .bind(2019, 'Old tent', 500).run();
  await env.DB_CORE.prepare('INSERT INTO manual_years (year, addedby, addedat) VALUES (?,?,?)')
    .bind(2030, 'USER0001', '2026-01-01').run();

  const sql = [];
  env.DB_COLLECTIONS = countingD1(env.DB_COLLECTIONS, sql, 'collections');
  env.DB_LOANS_EXPENSES = countingD1(env.DB_LOANS_EXPENSES, sql, 'loans_expenses');
  env.DB_CORE = countingD1(env.DB_CORE, sql, 'core');

  const years = await getYears(env);
  assert.deepEqual(years, [2030, 2026, 2025, 2024, 2023, 2019], 'the same answer as before, newest first');

  // Before: five `SELECT * FROM <table> ORDER BY id ASC` — 400+ rows into the
  // isolate to produce six integers, on every cache miss and after every write.
  assert.ok(sql.every(q => /SELECT DISTINCT year/.test(q)),
    `every query must be a DISTINCT projection:\n${sql.join('\n')}`);
  assert.ok(!sql.some(q => /SELECT \*/.test(q)), 'no full-row scan survives');
  assert.equal(sql.length, 5, 'still five statements — the tables live in three separate D1 databases');
});

test('M-19: a table missing on this deployment does not blank the year picker', async () => {
  const env = makeEnv();
  await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?,?,?)')
    .bind(2026, 1, 'D').run();
  // manual_years absent, e.g. a partially migrated deployment.
  env.DB_CORE = { prepare: () => { throw new Error('D1_ERROR: no such table: manual_years'); } };

  // The year picker is the navigation for the whole portal — one missing table must
  // not empty it.
  assert.deepEqual(await getYears(env), [2026]);
});

test('M-19: an absent binding is skipped rather than throwing', async () => {
  const env = makeEnv();
  await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name) VALUES (?,?,?)')
    .bind(2026, 1, 'D').run();
  delete env.DB_LOANS_EXPENSES;
  assert.deepEqual(await getYears(env), [2026]);
});

// ============================== M-16: addCustomAnnouncement counted by reading

test('M-16: the queue position is computed with COUNT(*), not by reading every row', async () => {
  const env = makeEnv();
  for (let i = 0; i < 250; i++) {
    await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name, amount) VALUES (?,?,?,?)')
      .bind(2026, i + 1, `D${i}`, 100).run();
  }
  const sql = [];
  env.DB_COLLECTIONS = countingD1(env.DB_COLLECTIONS, sql, 'collections');

  const { id } = await addCustomAnnouncement(env, 2026, 'नमस्ते', 'Hello', false, SUPERADMIN);

  const order = await env.DB_MISC.prepare('SELECT "order" FROM custom_announcements WHERE id_code = ?')
    .bind(id).first('order');
  assert.equal(Number(order), 250, 'the new item still lands at the end of the queue');
  assert.deepEqual(sql.map(q => /COUNT\(\*\)/.test(q)), [true],
    `exactly one COUNT(*) and no row read:\n${sql.join('\n')}`);
});

// ==================================== M-18: resolveEntry scanned to find one row

test('M-18: a receipt resolves its row by primary key, not by scanning the year', async () => {
  const env = makeEnv();
  await env.DB_CORE.prepare('INSERT INTO users (id_code, name, village, mobile) VALUES (?,?,?,?)')
    .bind('USER0001', 'Ram', 'Chhapra', 9800000001).run();
  for (let i = 0; i < 300; i++) {
    await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name, amount) VALUES (?,?,?,?)')
      .bind(2026, i + 1, 'USER0001', 100 + i).run();
  }
  await env.DB_TEMPLATES.prepare('INSERT INTO receipt_templates (year, template_text, page_size) VALUES (?,?,?)')
    .bind(2026, 'For {{NAME}}', 'A5').run();

  const sql = [];
  env.DB_COLLECTIONS = countingD1(env.DB_COLLECTIONS, sql, 'collections');
  env.DB_CORE = countingD1(env.DB_CORE, sql, 'core');

  const res = await getReceiptData(env, 7, 2026, SUPERADMIN);
  assert.equal(res.placeholders.NAME, 'Ram', 'the contributor is still resolved by ID, not Name');
  assert.match(res.placeholders.RECEIPT_NO, /NCS-2026-7$/);

  for (const q of sql) {
    assert.ok(!/SELECT \* FROM collections ORDER BY/.test(q), `full scan survived: ${q}`);
    assert.ok(!/SELECT \* FROM users ORDER BY/.test(q), `full USERS scan survived: ${q}`);
  }
  assert.ok(sql.some(q => /WHERE id = \?/.test(q)), 'the row is fetched by primary key');
});

test('M-18: the year check is now explicit, and still refuses a mismatch', async () => {
  const env = makeEnv();
  await env.DB_CORE.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').bind('USER0001', 'Ram').run();
  const r = await env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name, amount) VALUES (?,?,?,?)')
    .bind(2025, 1, 'USER0001', 100).run();
  await env.DB_CORE.prepare('INSERT INTO committee_members (year, name) VALUES (?,?)').bind(2026, 'USER0001').run();

  // Previously the row simply was not in the filtered list, so the error came from
  // "not found". Now the year is checked deliberately and says so.
  const e = await getReceiptData(env, r.meta.last_row_id, 2026, SUPERADMIN).then(() => null, x => x);
  assert.ok(e);
  assert.match(e.message, /not found for this year/);

  const gone = await getReceiptData(env, 4242, 2026, SUPERADMIN).then(() => null, x => x);
  assert.match(gone.message, /Collection entry not found\./);
});

// ================================= M-17: bulk generation read every row ever

test('M-17: getRecordsForDocType scopes by year and fetches only the members it needs', async () => {
  const env = makeEnv();
  for (const [code, name] of [['USER0001', 'Ram'], ['USER0002', 'Shyam']]) {
    await env.DB_CORE.prepare('INSERT INTO users (id_code, name, mobile) VALUES (?,?,?)')
      .bind(code, name, 9800000001).run();
  }
  // 50 rows in the wanted year, 200 in other years that must never be read.
  for (let i = 0; i < 50; i++) {
    await env.DB_COLLECTIONS.prepare(
      'INSERT INTO collections (year, sl_no, name, amount, certificate_or_receipt) VALUES (?,?,?,?,?)'
    ).bind(2026, i + 1, 'USER0001', 100, 'Receipt').run();
  }
  for (let i = 0; i < 200; i++) {
    await env.DB_COLLECTIONS.prepare(
      'INSERT INTO collections (year, sl_no, name, amount, certificate_or_receipt) VALUES (?,?,?,?,?)'
    ).bind(2020 + (i % 4), i + 1, 'USER0002', 100, 'Receipt').run();
  }

  const sql = [];
  env.DB_COLLECTIONS = countingD1(env.DB_COLLECTIONS, sql, 'collections');
  env.DB_CORE = countingD1(env.DB_CORE, sql, 'core');

  const records = await getRecordsForDocType(env, 'receipt', 2026, SUPERADMIN);
  assert.equal(records.length, 50, 'only the wanted year');
  assert.equal(records[0].placeholders.NAME, 'Ram', 'names still resolve');

  assert.ok(sql.some(q => /FROM collections WHERE year = \?/.test(q)), 'the year is pushed into SQL');
  assert.ok(!sql.some(q => /SELECT \* FROM collections ORDER BY id ASC/.test(q)),
    'the full-table scan is gone');
  assert.ok(!sql.some(q => /SELECT \* FROM users ORDER BY id ASC/.test(q)),
    'and so is the full USERS scan');
  assert.ok(sql.some(q => /FROM users WHERE id_code IN/.test(q)), 'members come back by id');
});

// ================================================= M-20: every slide, every time

test('M-20: only the slides of the popups being returned are read', async () => {
  const env = makeEnv();
  const live = await savePopup(env, null, 'Live', 'Superadmin', true, '', '', SUPERADMIN);
  const dead = await savePopup(env, null, 'Inactive', 'Superadmin', false, '', '', SUPERADMIN);
  for (const p of [live, dead]) {
    await savePopupSlides(env, p.popup_id, [
      { imageUrl: 'https://x.test/a.png', text: 'a' },
      { imageUrl: 'https://x.test/b.png', text: 'b' },
    ], SUPERADMIN);
  }

  const sql = [];
  env.DB_MISC = countingD1(env.DB_MISC, sql, 'misc');
  const out = await getActivePopups(env, SUPERADMIN);

  assert.equal(out.length, 1, 'only the live popup');
  assert.equal(out[0].slides.length, 2, 'with its slides intact');

  const slideQueries = sql.filter(q => /popup_slides/.test(q));
  assert.equal(slideQueries.length, 1);
  assert.match(slideQueries[0], /WHERE popup_id IN/,
    `slides must be scoped to the returned popups, was: ${slideQueries[0]}`);
  assert.ok(!/SELECT \* FROM popup_slides ORDER BY/.test(slideQueries[0]),
    'the unscoped every-slide read is gone');
});

test('M-20: the popup ROW filter deliberately stays in JS', () => {
  // Pushing `WHERE active = '1'` down would re-break every row the sheet migration
  // wrote as 'True' — the exact bug the comment in popups.js records. `popups` holds
  // a handful of rows, so the scan costs nothing; `popup_slides` was the row-heavy
  // half and that is what got scoped.
  const src = readFileSync(new URL('../src/popups.js', import.meta.url), 'utf8');
  assert.match(src, /const \{ results: allPopups \} = await env\.DB_MISC\.prepare\('SELECT \* FROM popups'\)/,
    'if this is ever pushed down, isTruthyFlag must go with it');
});

// ============================================ M-21: the silent lossy fallback

test('M-21: the racy UPSERT fallback now warns instead of failing silently', async () => {
  const env = makeEnv();
  // portal_settings without the UNIQUE index on "key" — i.e. migration
  // 2026-09-01/08 not applied. ON CONFLICT("key") then throws.
  const realPrepare = env.DB_CORE.prepare.bind(env.DB_CORE);
  env.DB_CORE.prepare = (sql) => {
    if (/ON CONFLICT/.test(sql)) throw new Error('D1_ERROR: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint');
    return realPrepare(sql);
  };

  await bumpDataVersion(env);

  const logged = (await env.DB_LOGS.prepare('SELECT source, page, message FROM error_log').all()).results;
  assert.equal(logged.length, 1, 'the fallback is no longer silent');
  assert.equal(logged[0].page, 'bumpDataVersion');
  assert.match(logged[0].message, /no UNIQUE index/);
  assert.match(logged[0].message, /serve stale data under a matching ETag/,
    'the message states the consequence, not just the cause');
  assert.match(logged[0].message, /08-public-data-version\.sql/, 'and names the fix');

  // ...and the bump still happened, because this path is best-effort by design.
  const v = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?')
    .bind('public_data_version').first('value');
  assert.equal(v, '1');
});

test('M-21: a healthy UPSERT writes nothing to the Error Log', async () => {
  const env = makeEnv();
  env.DB_CORE._db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_settings_key ON portal_settings("key")');
  await bumpDataVersion(env);
  await bumpDataVersion(env);
  assert.equal(await env.DB_LOGS.prepare('SELECT COUNT(*) AS n FROM error_log').first('n'), 0,
    'the normal path must stay quiet, or the warning is noise');
  assert.equal(
    await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?').bind('public_data_version').first('value'),
    '2', 'and the atomic path still increments'
  );
});

// ========================================== M-22: a 500-placeholder claim

test('M-22: the queue claim is chunked at 50 placeholders', async () => {
  const env = makeEnv();
  for (let i = 0; i < 120; i++) {
    await queuePersonMessageDirect(env, '919800000001', `msg ${i}`, '', 'normal', '');
  }
  const sql = [];
  env.DB_WHATSAPP_INDEX = countingD1(env.DB_WHATSAPP_INDEX, sql, 'wa');

  const rows = await getPendingMessages(env, 120);
  assert.equal(rows.length, 120, 'all 120 are still claimed and returned');

  const claims = sql.filter(q => /SET status = 'sending'/.test(q));
  assert.equal(claims.length, 3, '120 ids -> 3 chunks of at most 50');
  for (const c of claims) {
    const placeholders = (c.match(/\?/g) || []).length;
    assert.ok(placeholders <= 51, `a claim carried ${placeholders} parameters: ${c}`);
  }
  // Before: ONE statement with 120 (up to 500) placeholders.
});

test('M-22: the re-read still recovers exactly this poll\'s rows via the shared token', async () => {
  const env = makeEnv();
  for (let i = 0; i < 60; i++) {
    await queuePersonMessageDirect(env, '919800000001', `m${i}`, '', 'normal', '');
  }
  const rows = await getPendingMessages(env, 60);
  assert.equal(rows.length, 60, 'chunking must not lose the rows from the later chunks');
  const ids = new Set(rows.map(r => r.message_id));
  assert.equal(ids.size, 60, 'and must not double-serve any of them');
});

// ============================================ M-13: the migration + the query

const MIGRATION = new URL('../../db/migration/2026-09-05/09-error-log-client-ip.sql', import.meta.url);

// error_log.client_ip is in logs.sql itself now (schema-is-the-end-state.test.mjs), so
// this no longer proves the ADD COLUMN — it proves the BACKFILL, which is the part that
// still matters for an existing database. The ALTER is stripped for that reason; leaving
// it in would fail with "duplicate column" against the end-state schema.
test('M-13 migration: backfills the IP out of context (the column itself is in the schema now)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('logs.sql'));
  db.exec(`INSERT INTO error_log (error_id, source, page, message, context, created_at)
           VALUES ('E1','public','portal','boom','{"edgeIp":"203.0.113.9","ua":"x"}','2026-09-01'),
                  ('E2','public','portal','boom2','{"note":"no ip here"}','2026-09-01')`);

  const sql = readFileSync(MIGRATION, 'utf8')
    .split('\n').filter((l) => !/^\s*ALTER\s+TABLE/i.test(l)).join('\n');
  db.exec(sql);

  const rows = db.prepare('SELECT error_id, client_ip FROM error_log ORDER BY error_id').all().map(r => ({ ...r }));
  assert.deepEqual(rows, [
    { error_id: 'E1', client_ip: '203.0.113.9' },
    { error_id: 'E2', client_ip: null },
  ], 'history is backfilled so the limiter counts it, and rows without an IP are left alone');

  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get('idx_error_log_client_ip_created_at');
  assert.ok(idx, 'the index the limiter depends on exists');
});

test('M-13 migration: the CREATE INDEX and UPDATE halves are re-runnable', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('logs.sql'));
  const full = readFileSync(MIGRATION, 'utf8');

  // `error_log.client_ip` is part of logs.sql itself now, so the FIRST run against a
  // schema-built database is the one that hits the duplicate — SQLite has no
  // `ADD COLUMN IF NOT EXISTS`. Assert that precisely, so an operator knows a run
  // against a fresh database is a harmless no-op and not a broken migration.
  const err = (() => { try { db.exec(full); return null; } catch (e) { return e; } })();
  assert.ok(err, 'the ALTER does raise against the end-state schema');
  assert.match(err.message, /duplicate column name: client_ip/,
    'and only because the column already exists — nothing else in the file fails');

  // The idempotent halves really are idempotent — the index and the backfill can be run
  // as often as you like, which is what matters for an EXISTING database.
  const sql = full.split('\n').filter((l) => !/^\s*ALTER\s+TABLE/i.test(l)).join('\n');
  db.exec(sql);
  db.exec(sql);
  db.exec('CREATE INDEX IF NOT EXISTS idx_error_log_client_ip_created_at ON error_log (client_ip, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_error_log_client_ip_created_at ON error_log (client_ip, created_at)');
});

test('M-13: the limiter query is index-served and no longer a leading-wildcard LIKE', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('logs.sql'));
  // No migration to apply: both the column and idx_error_log_client_ip_created_at are in
  // logs.sql now, which is the property being checked — a fresh database answers the
  // limiter's query from an index without anything else being run.

  const plan = db.prepare(
    'EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM error_log WHERE client_ip = ? AND created_at >= ?'
  ).all().map(r => r.detail).join(' | ');
  assert.match(plan, /USING (COVERING )?INDEX idx_error_log_client_ip_created_at/,
    `expected an index search, got: ${plan}`);

  const oldPlan = db.prepare(
    'EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ? AND context LIKE ?'
  ).all().map(r => r.detail).join(' | ');
  assert.ok(!/USING INDEX idx_error_log_client_ip/.test(oldPlan),
    `the old predicate could not use it — that was the point: ${oldPlan}`);
});

// =================================== M-12 / M-23: the decisions, pinned

test('M-12: sampling was tightened, NOT set to 1 (which would exhaust the write quota)', () => {
  const src = readFileSync(new URL('../../../Public/backend/src/index.js', import.meta.url), 'utf8');
  const m = src.match(/^const RL_SAMPLE = (\d+);/m);
  assert.ok(m, 'RL_SAMPLE is still a single tunable');
  const sample = parseInt(m[1]);
  assert.ok(sample > 1, 'sample 1 costs a KV write per request: 60/min/IP = 86,400/day vs a ~1,000/day budget');
  assert.ok(sample < 20, 'and it can be tighter than 20 now that the namespace is not shared with mgmt');
  assert.equal(sample, 5);
});

test('M-13: the Public Worker writes client_ip, with a fallback for the un-migrated case', () => {
  const src = readFileSync(new URL('../../../Public/backend/src/index.js', import.meta.url), 'utf8');
  assert.match(src, /INSERT INTO error_log \([^)]*client_ip\)/, 'the column is written');
  assert.match(src, /if \(!\/client_ip\/i\.test/,
    'and a deployment without the migration retries without it rather than losing the report');
  assert.match(src, /WHERE client_ip = \? AND created_at >= \?/, 'the limiter uses the indexed predicate');
});

test('M-23: the D1 budget counter states why it cannot be atomic on the free tier', () => {
  const src = readFileSync(new URL('../../../Public/backend/src/index.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('audit M-23'), src.indexOf('async function d1BudgetAdd'));
  assert.match(block, /no atomic increment/, 'KV cannot do this');
  assert.match(block, /Durable Objects/, 'and the primitive that can is paid-plan');
  // The counter now charges the ACTUAL rows read (countPayloadRows) instead of a
  // fixed 60,000 over-estimate that made an idle deployment look ~75% consumed.
  assert.match(block, /ACTUAL rows the build read|countPayloadRows/, 'the charge is the real row count, not a fixed over-estimate');
});

test('M-23: d1BudgetAdd charges the real row count (not a fixed 60000 over-estimate)', () => {
  const src = readFileSync(new URL('../../../Public/backend/src/index.js', import.meta.url), 'utf8');
  // The old flat over-estimate constant is gone.
  assert.ok(!/const D1_ROWS_PER_BUILD\s*=\s*60000/.test(src), 'the fixed 60000 over-estimate must be removed');
  // A floor keeps an empty build non-zero, and the payload row count is summed.
  assert.match(src, /D1_BUILD_ROWS_FLOOR/, 'a per-build floor exists');
  assert.match(src, /function countPayloadRows/, 'the build charges the summed payload row count');
});

// ============================ EVERY MIGRATION STAYS TEST-COVERED (CI job)

test('the new migration is registered so CI checks it applies against the schema', () => {
  const dir = new URL('../../db/migration/2026-09-05/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.sql'));
  const allTests = readdirSync(new URL('./', import.meta.url))
    .filter(f => f.endsWith('.test.mjs'))
    .map(f => readFileSync(new URL(f, import.meta.url), 'utf8'))
    .join('\n');
  for (const f of files) {
    assert.ok(allTests.includes(f), `${f} is not referenced by any test — the CI migrations job will fail`);
  }
});
