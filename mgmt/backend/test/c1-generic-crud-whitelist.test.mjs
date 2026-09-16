// ============ AUDIT C-1 — privilege escalation via the generic CRUD actions ============
//
// Proves, against a REAL SQLite engine holding the REAL committed schema, that:
//   1. An Admin can no longer reach `login_users` through updateRecord and promote
//      themselves to Superadmin  (the actual exploit).
//   2. The same is true for every other sensitive table resolveSheet() can reach.
//   3. The six ordinary data sheets still work for the roles that should have them
//      (i.e. the fix did not break the portal).
//
// Run: node --test mgmt/backend/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { saveRecord, updateRecordByIdx, deleteRecordByIdx, assertGenericSheetAllowed } from '../src/crud.js';
import { requireRole } from '../src/auth.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0002', role: 'Admin' };
const SUBADMIN = { name: 'USER0003', role: 'Subadmin' };

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  const loansExpenses = makeD1(schemaFor('loans_expenses.sql'));
  const fileIndex = makeD1(schemaFor('file_index.sql'));
  const logs = makeD1(schemaFor('logs.sql'));
  const misc = makeD1(schemaFor('misc.sql'));

  // An Admin login row — the escalation target.
  core.prepare('INSERT INTO login_users (id, name, password, role, updated_at) VALUES (?,?,?,?,?)')
    .bind(7, 'USER0002', 'pbkdf2$x', 'Admin', '2026-01-01').run();
  // The loan the consent belongs to. Needed since the committed schema carries the
  // loan-relation triggers (a consent naming a loan that does not exist is refused) —
  // which makes this fixture more like a real database than it was before.
  loansExpenses.prepare('INSERT INTO loans (year, loan_id, name) VALUES (?,?,?)')
    .bind(2026, 'LN1', 'USER0009').run();
  // A pending consent — the forgery target.
  loansExpenses.prepare(
    'INSERT INTO loan_consents (id, consent_id, loan_id, person_id, role, token, status) VALUES (?,?,?,?,?,?,?)')
    .bind(1, 'CN1', 'LN1', 'USER0009', 'guarantor', 'secret-token', 'pending').run();
  // An indexed generated file — the public-portal tampering target.
  fileIndex.prepare(
    'INSERT INTO generated_files (id, doc_type, year, record_id, file_name, public_link) VALUES (?,?,?,?,?,?)')
    .bind(1, 'receipt', 2026, 'receipt-2026-1', 'r.pdf', 'https://real/r.pdf').run();
  // An audit-trail row — the tampering target.
  logs.prepare('INSERT INTO activity_log (id, timestamp, name, action, details) VALUES (?,?,?,?,?)')
    .bind(1, '2026-01-01', 'USER0002', 'add COLLECTIONS', 'original').run();
  // Committee membership for 2026 — requireYearAccess() legitimately blocks an
  // Admin/Subadmin from touching a year they were not on the committee for, so the
  // "the fix did not break anything" cases need this to reach the write at all.
  for (const name of ['USER0002', 'USER0003']) {
    core.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
      .bind(2026, name, 'Member').run();
  }

  return {
    DB_CORE: core, DB_COLLECTIONS: collections, DB_LOANS_EXPENSES: loansExpenses,
    DB_FILE_INDEX: fileIndex, DB_LOGS: logs, DB_MISC: misc,
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
  };
}

// ---------------------------------------------------------------- THE EXPLOIT

test('C-1: an Admin CANNOT promote themselves to Superadmin via updateRecord', async () => {
  const env = makeEnv();

  const before = await env.DB_CORE.prepare('SELECT role FROM login_users WHERE id = 7').first();
  assert.equal(before.role, 'Admin', 'precondition: the target starts as Admin');

  await assert.rejects(
    () => updateRecordByIdx(env, 'LOGIN', 7, { Role: 'Superadmin' }, ADMIN),
    (err) => {
      assert.equal(err.permission, true, 'must be a PermissionError (HTTP 403)');
      assert.equal(err.expected, true, 'must not pollute the error log as a defect');
      assert.match(err.message, /cannot be changed from this screen/);
      return true;
    },
    'the escalation must be refused'
  );

  const after = await env.DB_CORE.prepare('SELECT role FROM login_users WHERE id = 7').first();
  assert.equal(after.role, 'Admin', 'the role must be UNCHANGED in the database');
});

test('C-1: an Admin CANNOT forge a loan consent via updateRecord', async () => {
  const env = makeEnv();

  await assert.rejects(
    () => updateRecordByIdx(env, 'loan_consents', 1,
      { status: 'accepted', verification_status: 'verified' }, ADMIN),
    /cannot be changed from this screen/
  );

  const row = await env.DB_LOANS_EXPENSES.prepare('SELECT status, verification_status FROM loan_consents WHERE id = 1').first();
  assert.equal(row.status, 'pending', 'the consent must still be pending');
  assert.equal(row.verification_status, null, 'verification must not have been forged');
});

test('C-1: nobody can repoint a public "Verified Record" link via updateRecord', async () => {
  const env = makeEnv();
  for (const actor of [SUPERADMIN, ADMIN, SUBADMIN]) {
    await assert.rejects(
      () => updateRecordByIdx(env, 'generated_files', 1, { public_link: 'https://evil/x.pdf' }, actor),
      /cannot be changed from this screen/,
      `${actor.role} must be refused`
    );
  }
  const row = await env.DB_FILE_INDEX.prepare('SELECT public_link FROM generated_files WHERE id = 1').first();
  assert.equal(row.public_link, 'https://real/r.pdf', 'the link must be untouched');
});

test('C-1: the audit trail cannot be edited or deleted via the generic actions', async () => {
  const env = makeEnv();
  await assert.rejects(() => updateRecordByIdx(env, 'activity log', 1, { details: 'tampered' }, ADMIN),
    /cannot be changed from this screen/);
  await assert.rejects(() => deleteRecordByIdx(env, 'activity log', 1, SUPERADMIN),
    /cannot be changed from this screen/);
  const row = await env.DB_LOGS.prepare('SELECT details FROM activity_log WHERE id = 1').first();
  assert.equal(row.details, 'original');
});

test('C-1: every sensitive registry table is refused for add/edit/delete, for every role', async () => {
  const env = makeEnv();
  const FORBIDDEN = [
    'login', 'LOGIN', 'loan_consents', 'generated_files', 'activity log', 'error_log',
    'portal_settings', 'popups', 'popup_slides', 'announcement_links', 'custom_announcements',
    'docx_templates', 'receipt_templates', 'certificate_templates', 'samaan_templates',
    'consent_page_templates', 'doc_pdf_templates', 'pdf_templates', 'dropdown_lists',
    'festival_dates', 'locked years', 'manual years', 'loan_message_templates',
    'group_message_templates', 'person_message_templates', 'whatsapp_groups',
    'group_messages', 'person_messages',
  ];
  let refused = 0;
  for (const sheet of FORBIDDEN) {
    for (const actor of [SUPERADMIN, ADMIN, SUBADMIN]) {
      await assert.rejects(() => saveRecord(env, sheet, { Name: 'x' }, actor), /cannot be changed from this screen/);
      await assert.rejects(() => updateRecordByIdx(env, sheet, 1, { Name: 'x' }, actor), /cannot be changed from this screen/);
      await assert.rejects(() => deleteRecordByIdx(env, sheet, 1, actor), /cannot be changed from this screen/);
      refused += 3;
    }
  }
  assert.equal(refused, FORBIDDEN.length * 3 * 3);
  assert.ok(refused >= 250, `expected a broad sweep, got ${refused} refusals`);
});

test('C-1: an unknown sheet name is refused, not silently guessed', async () => {
  const env = makeEnv();
  for (const sheet of ['', null, undefined, 'nope', 'sqlite_master', 'USERS; DROP TABLE users']) {
    await assert.rejects(() => updateRecordByIdx(env, sheet, 1, { Name: 'x' }, SUPERADMIN),
      /cannot be changed from this screen/);
  }
});

// ------------------------------------------------- THE FIX DID NOT BREAK THINGS

test('C-1 regression guard: the six ordinary data sheets are still allowed', () => {
  for (const sheet of ['USERS', 'COLLECTIONS', 'EXPENSES', 'COMMITEE MEMBERS', 'LOANS', 'LOAN GUARANTOR']) {
    assert.equal(assertGenericSheetAllowed(sheet), sheet.toUpperCase());
    // …and case/whitespace tolerance is preserved, as resolveSheet() has always done.
    assert.equal(assertGenericSheetAllowed(`  ${sheet.toLowerCase()} `), sheet.toUpperCase());
  }
});

test('C-1 regression guard: a Superadmin can still save, edit and delete a collection', async () => {
  const env = makeEnv();

  const saved = await saveRecord(env, 'COLLECTIONS',
    { Year: 2026, Name: 'USER0009', Amount: 500, 'Payment Mode': 'Cash' }, SUPERADMIN);
  assert.equal(saved.success, true);
  assert.ok(saved.rowIndex > 0, 'a real row id must come back');

  const row = await env.DB_COLLECTIONS.prepare('SELECT amount, sl_no FROM collections WHERE id = ?')
    .bind(saved.rowIndex).first();
  assert.equal(row.amount, 500);
  assert.equal(row.sl_no, 1, 'Sl. No. is still allocated');

  await updateRecordByIdx(env, 'COLLECTIONS', saved.rowIndex,
    { Year: 2026, Name: 'USER0009', Amount: 750 }, SUPERADMIN);
  const edited = await env.DB_COLLECTIONS.prepare('SELECT amount FROM collections WHERE id = ?')
    .bind(saved.rowIndex).first();
  assert.equal(edited.amount, 750, 'the edit must still go through');

  await deleteRecordByIdx(env, 'COLLECTIONS', saved.rowIndex, SUPERADMIN);
  const gone = await env.DB_COLLECTIONS.prepare('SELECT id FROM collections WHERE id = ?')
    .bind(saved.rowIndex).first();
  assert.equal(gone, null, 'the delete must still go through');
});

test('C-1 regression guard: a Subadmin can still add a User and a Collection, and still cannot edit', async () => {
  const env = makeEnv();
  const u = await saveRecord(env, 'USERS', { Name: 'New Member', Village: 'Shaharpura' }, SUBADMIN);
  assert.equal(u.id, 'USER0001', 'the USER#### allocator still runs');

  const c = await saveRecord(env, 'COLLECTIONS', { Year: 2026, Name: 'USER0001', Amount: 100 }, SUBADMIN);
  assert.equal(c.success, true);

  await assert.rejects(() => saveRecord(env, 'EXPENSES', { Discription: 'x', Amount: 5 }, SUBADMIN),
    /can only add Users and Contributions/);
  await assert.rejects(() => updateRecordByIdx(env, 'COLLECTIONS', c.rowIndex, { Amount: 1 }, SUBADMIN),
    /does not have permission/);
  await assert.rejects(() => deleteRecordByIdx(env, 'COLLECTIONS', c.rowIndex, SUBADMIN),
    /does not have permission/);
});

// --------------------------------------------------------- requireRole hardening

test('C-1: requireRole now scopes the sheet for EVERY action, not just add', () => {
  // A Subadmin holds only 'add' today, so this was not directly exploitable — but
  // the omission is the same shape as the Admin hole and must not come back.
  assert.throws(() => requireRole({ role: 'Subadmin' }, 'add', 'EXPENSES'), /can only add Users and Contributions/);
  assert.doesNotThrow(() => requireRole({ role: 'Subadmin' }, 'add', 'USERS'));
  assert.doesNotThrow(() => requireRole({ role: 'Subadmin' }, 'add', 'COLLECTIONS'));
  // Admin keeps full access to the generic data sheets.
  for (const sheet of ['USERS', 'COLLECTIONS', 'EXPENSES', 'COMMITEE MEMBERS', 'LOANS']) {
    assert.doesNotThrow(() => requireRole({ role: 'Admin' }, 'edit', sheet));
  }
  assert.throws(() => requireRole({ role: 'Admin' }, 'delete', 'COLLECTIONS'), /does not have permission/);
});

test('C-1: an unknown or missing role has no write permission at all', () => {
  for (const role of ['Treasurer', '', undefined, null]) {
    for (const action of ['add', 'edit', 'delete']) {
      assert.throws(() => requireRole({ role }, action, 'COLLECTIONS'), /does not have permission/);
    }
  }
  // …and requireRole must not itself throw a TypeError on a malformed user.
  assert.throws(() => requireRole(undefined, 'add', 'USERS'), /does not have permission/);
});
