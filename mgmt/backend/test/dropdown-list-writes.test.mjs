// ============ FEAT-002 — List Management ADD silently lost data ============
//
// mgmt/backend/src/dropdownLists.js addDropdownListItem/updateDropdownListItem/
// deleteDropdownListItem each ran a D1 `.run()` write and unconditionally
// returned { success: true } WITHOUT inspecting result.meta.changes.
//
// On live, the dropdown_lists table's `id` column had lost its
// `INTEGER PRIMARY KEY AUTOINCREMENT` definition (a `wrangler d1 export` +
// restore recreates it as a plain `id INTEGER`). Against that drifted table an
// INSERT that omits id stores id=NULL and does not persist as a usable row,
// while UPDATE ... WHERE id=? against the surviving seeded rows keeps working —
// exactly the observed fingerprint (EDIT persists, ADD silently lost).
//
// The fix follows the meta.changes pattern already used across the codebase
// (announcements.js markAnnounced, templates.js:162, ...): after a write, assert
// result.meta.changes and throw ValidationError when a mutation changed 0 rows.
// This test is prove-first: the DRIFT GUARD case fails on the pre-fix handler
// (which returned { success: true } for a no-op INSERT) and passes after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import {
  addDropdownListItem,
  updateDropdownListItem,
  deleteDropdownListItem,
  getAllDropdownLists,
} from '../src/dropdownLists.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

// A drift variant that makes writes SILENTLY NO-OP (meta.changes === 0).
//
// A `wrangler d1 export` + restore can leave `dropdown_lists` in a shape that no
// longer accepts the handler's INSERT as a real row change. This models the
// general failure the fix defends against: the write "succeeds" at the driver
// level but affects 0 rows. Here dropdown_lists is a VIEW over the real table with
// a no-op INSTEAD OF INSERT trigger, so INSERT reports changes=0 — the pre-fix
// handler returned { success: true } and the row was silently lost; the fixed
// handler throws instead. (Node's node:sqlite reports changes=0 for this, exactly
// like D1.)
const DRIFTED_NOOP_SCHEMA = `
CREATE TABLE dropdown_lists_real (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_type TEXT, english_value TEXT, hindi_label TEXT, active TEXT, sort_order INTEGER
);
CREATE VIEW dropdown_lists AS SELECT * FROM dropdown_lists_real;
CREATE TRIGGER dropdown_lists_noop_insert INSTEAD OF INSERT ON dropdown_lists
BEGIN SELECT 1; END;
CREATE TRIGGER dropdown_lists_noop_update INSTEAD OF UPDATE ON dropdown_lists
BEGIN SELECT 1; END;
CREATE TRIGGER dropdown_lists_noop_delete INSTEAD OF DELETE ON dropdown_lists
BEGIN SELECT 1; END;`;

// The exact reproduction shape: `id` is a plain INTEGER that lost its
// INTEGER PRIMARY KEY AUTOINCREMENT. Kept here to DOCUMENT the observed live
// fingerprint (an INSERT reports changes=1 but stores id=NULL, so __rowIndex is
// null and the row is unusable). See the test below for what meta.changes can and
// cannot detect for this specific variant.
const DRIFTED_NULLID_SCHEMA = `CREATE TABLE dropdown_lists (
  id INTEGER,
  list_type TEXT,
  english_value TEXT,
  hindi_label TEXT,
  active TEXT,
  sort_order INTEGER
);`;

function envWith(db) {
  return { DB_CORE: db };
}

// ---- (a) PERSISTENCE against the REAL committed schema ----
test('addDropdownListItem persists a usable row against the real schema', async () => {
  const env = envWith(makeD1(schemaFor('core.sql')));

  const res = await addDropdownListItem(env, 'Village', 'Shaharpura', 'शहरपुरा', SUPERADMIN);
  assert.deepEqual(res, { success: true });

  const grouped = await getAllDropdownLists(env);
  const row = grouped['Village'].find(r => r['English Value'] === 'Shaharpura');
  assert.ok(row, 'the added value should be present in getAllDropdownLists');
  assert.notEqual(row.__rowIndex, null, '__rowIndex must be a real (non-null) id');
  assert.ok(row.__rowIndex > 0, '__rowIndex must be a positive autoincrement id');
  assert.equal(row['Hindi Label'], 'शहरपुरा');
  // active is stored as 1 and sort_order as max+1 (1 for the first row).
  assert.equal(String(row['Active']), '1');
  assert.equal(Number(row['Sort Order']), 1);
});

test('a second add gets sort_order max+1', async () => {
  const env = envWith(makeD1(schemaFor('core.sql')));
  await addDropdownListItem(env, 'Category', 'General', '', SUPERADMIN);
  await addDropdownListItem(env, 'Category', 'Special', '', SUPERADMIN);

  const grouped = await getAllDropdownLists(env);
  const orders = grouped['Category'].map(r => Number(r['Sort Order'])).sort((x, y) => x - y);
  assert.deepEqual(orders, [1, 2]);
});

// ---- (b) PROVE-FIRST DRIFT GUARD ----
// Against a drifted schema where the INSERT silently affects 0 rows, the pre-fix
// handler returned { success: true } (the row was silently lost). The fix must
// surface a visible ValidationError instead. This is the test that FAILS on the
// pre-fix code (no rejection) and PASSES after (rejects) — confirmed by stashing
// the src change; see FEAT-002 findings.
test('addDropdownListItem rejects (does not silently succeed) when a drifted schema no-ops the write', async () => {
  const env = envWith(makeD1(DRIFTED_NOOP_SCHEMA));

  await assert.rejects(
    () => addDropdownListItem(env, 'Village', 'Ghost Village', '', SUPERADMIN),
    (err) => {
      assert.ok(err instanceof Error, 'should throw an Error');
      assert.equal(err.message, 'Could not add the item. Please try again.');
      assert.equal(err.expected, true, 'ValidationError is marked expected');
      return true;
    },
  );

  // And nothing was persisted.
  const grouped = await getAllDropdownLists(env);
  const ghost = (grouped['Village'] || []).find(r => r['English Value'] === 'Ghost Village');
  assert.ok(!ghost, 'no row should exist after a rejected drifted insert');
});

// A no-op UPDATE / DELETE on the drifted schema is likewise surfaced as an error
// rather than a false success.
test('update/delete reject when a drifted schema no-ops the write', async () => {
  const env = envWith(makeD1(DRIFTED_NOOP_SCHEMA));

  await assert.rejects(
    () => updateDropdownListItem(env, 1, 'X', undefined, undefined, SUPERADMIN),
    (err) => { assert.equal(err.message, 'Item not found.'); return true; },
  );
  await assert.rejects(
    () => deleteDropdownListItem(env, 1, SUPERADMIN),
    (err) => { assert.equal(err.message, 'Item not found.'); return true; },
  );
});

// DOCUMENTATION of the exact observed live fingerprint: a plain `id INTEGER`
// (having lost INTEGER PRIMARY KEY AUTOINCREMENT). Here the INSERT reports
// changes=1 but stores id=NULL, so the row is unusable (__rowIndex === null).
// meta.changes cannot distinguish this specific variant (the write really did
// change a row), which is why the durable fix for the live table is restoring the
// correct DDL — the meta.changes guard here still converts the broader class of
// silent no-op writes (case b above) into visible errors. This test pins the
// documented behavior so the limitation is explicit, not a surprise.
test('drifted plain-id INTEGER stores a NULL id (documented live fingerprint)', async () => {
  const env = envWith(makeD1(DRIFTED_NULLID_SCHEMA));

  // The add "succeeds" at the driver level (a row was inserted with id=NULL).
  const res = await addDropdownListItem(env, 'Village', 'Ghost Village', '', SUPERADMIN);
  assert.deepEqual(res, { success: true });

  const grouped = await getAllDropdownLists(env);
  const ghost = grouped['Village'].find(r => r['English Value'] === 'Ghost Village');
  assert.ok(ghost, 'a row was inserted');
  assert.equal(ghost.__rowIndex, null, 'but its id (__rowIndex) is NULL — the unusable-row fingerprint');
});

// ---- (c) UPDATE ----
test('updateDropdownListItem persists an edit and returns success', async () => {
  const env = envWith(makeD1(schemaFor('core.sql')));
  await addDropdownListItem(env, 'Village', 'Old Name', '', SUPERADMIN);
  let grouped = await getAllDropdownLists(env);
  const id = grouped['Village'].find(r => r['English Value'] === 'Old Name').__rowIndex;

  const res = await updateDropdownListItem(env, id, 'New Name', 'नया नाम', undefined, SUPERADMIN);
  assert.deepEqual(res, { success: true });

  grouped = await getAllDropdownLists(env);
  const row = grouped['Village'].find(r => r.__rowIndex === id);
  assert.equal(row['English Value'], 'New Name');
  assert.equal(row['Hindi Label'], 'नया नाम');
});

test('updateDropdownListItem throws Item not found. for a non-existent id', async () => {
  const env = envWith(makeD1(schemaFor('core.sql')));
  await assert.rejects(
    () => updateDropdownListItem(env, 999999, 'Whatever', undefined, undefined, SUPERADMIN),
    (err) => {
      assert.equal(err.message, 'Item not found.');
      assert.equal(err.expected, true);
      return true;
    },
  );
});

test('a no-field update is a legitimate no-op and returns success without throwing', async () => {
  const env = envWith(makeD1(schemaFor('core.sql')));
  await addDropdownListItem(env, 'Category', 'Keep', '', SUPERADMIN);
  const grouped = await getAllDropdownLists(env);
  const id = grouped['Category'].find(r => r['English Value'] === 'Keep').__rowIndex;

  // All of englishValue / hindiLabel / active undefined -> no SET clauses.
  const res = await updateDropdownListItem(env, id, undefined, undefined, undefined, SUPERADMIN);
  assert.deepEqual(res, { success: true });
});

// ---- (d) DELETE ----
test('deleteDropdownListItem removes an existing row and returns success', async () => {
  const env = envWith(makeD1(schemaFor('core.sql')));
  await addDropdownListItem(env, 'Village', 'To Delete', '', SUPERADMIN);
  let grouped = await getAllDropdownLists(env);
  const id = grouped['Village'].find(r => r['English Value'] === 'To Delete').__rowIndex;

  const res = await deleteDropdownListItem(env, id, SUPERADMIN);
  assert.deepEqual(res, { success: true });

  grouped = await getAllDropdownLists(env);
  assert.ok(!grouped['Village'].some(r => r.__rowIndex === id), 'row should be gone');
});

test('deleteDropdownListItem throws Item not found. for a non-existent id', async () => {
  const env = envWith(makeD1(schemaFor('core.sql')));
  await assert.rejects(
    () => deleteDropdownListItem(env, 999999, SUPERADMIN),
    (err) => {
      assert.equal(err.message, 'Item not found.');
      assert.equal(err.expected, true);
      return true;
    },
  );
});

// ---- (e) DUP CHECK still rejects a case-insensitive duplicate ----
test('addDropdownListItem rejects a case-insensitive duplicate', async () => {
  const env = envWith(makeD1(schemaFor('core.sql')));
  await addDropdownListItem(env, 'Village', 'Shaharpura', '', SUPERADMIN);

  await assert.rejects(
    () => addDropdownListItem(env, 'Village', 'SHAHARPURA', '', SUPERADMIN),
    (err) => {
      assert.equal(err.message, 'This value is already in the list.');
      return true;
    },
  );
});
