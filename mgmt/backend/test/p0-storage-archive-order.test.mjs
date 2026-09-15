// ====== AUDIT P0-06 — archiving must not destroy the source or publish evidence ======
//
// moveYearToDrive() copies a year's files from R2 to Google Drive. Two defects:
//
//  1. THE ORDER WAS THE REVERSE OF WHAT THE FILE CLAIMED. moveOneUrl() uploaded to
//     Drive and DELETED THE R2 OBJECT, and only then did the caller run the UPDATE.
//     If that UPDATE failed (a D1 blip, the isolate evicted mid-archive) the row
//     still pointed at an R2 object that no longer existed — a permanently broken
//     link to a receipt, or to a consent photo/signature that is legal evidence.
//
//  2. EVERY archived file was made anonymously readable. uploadBytesToDrive()
//     always called setAnyoneReader(), so archiving a year quietly published every
//     consent photo and SIGNATURE — undoing the deliberate `makePublic: false`
//     that uploadConsentFile() uses for exactly the same data.
//
// Now: upload -> conditional DB update -> verify the row -> only then delete. And
// consent evidence is archived PRIVATE while generated PDFs stay public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { moveYearToDrive } from '../src/storage.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const R2_BASE = 'https://files.test';

// A tiny R2 stub that records deletions, plus a fetch stub standing in for the
// Drive API (folder lookup, multipart upload, permission grant).
function makeEnv({ failDbUpdate = null } = {}) {
  const objects = new Map([
    ['2026/pdf/receipt/r1.pdf', { body: 'pdf-bytes', contentType: 'application/pdf' }],
    ['2026/consent/photo1.jpg', { body: 'photo-bytes', contentType: 'image/jpeg' }],
    ['2026/consent/sign1.jpg', { body: 'sign-bytes', contentType: 'image/jpeg' }],
  ]);
  const deleted = [];
  const permissionGrants = [];
  const uploads = [];

  const fileIndex = makeD1(schemaFor('file_index.sql'));
  const loansDb = makeD1(schemaFor('loans_expenses.sql'));

  fileIndex.prepare(
    'INSERT INTO generated_files (year, doc_type, record_id, file_name, public_link) VALUES (?,?,?,?,?)'
  ).bind(2026, 'receipt', 'receipt-2026-1', 'r1.pdf', `${R2_BASE}/2026/pdf/receipt/r1.pdf`).run();

  loansDb.prepare('INSERT INTO loans (year, name, amount, loan_id) VALUES (?,?,?,?)')
    .bind(2026, 'USER0002', 5000, 'LN-1').run();
  loansDb.prepare(
    'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, photo_url, signature_url) VALUES (?,?,?,?,?,?,?,?)'
  ).bind('CN-1', 'LN-1', 'USER0002', 'loaner', 'tok', 'accepted',
    `${R2_BASE}/2026/consent/photo1.jpg`, `${R2_BASE}/2026/consent/sign1.jpg`).run();

  // Optionally break one table's UPDATE, the way a D1 blip would.
  if (failDbUpdate === 'generated_files') {
    const real = fileIndex.prepare.bind(fileIndex);
    fileIndex.prepare = (sql) => (/UPDATE generated_files/.test(sql)
      ? { bind: () => ({ async run() { throw new Error('D1_ERROR: network error'); } }) }
      : real(sql));
  }
  if (failDbUpdate === 'loan_consents') {
    const real = loansDb.prepare.bind(loansDb);
    loansDb.prepare = (sql) => (/UPDATE loan_consents/.test(sql)
      ? { bind: () => ({ async run() { throw new Error('D1_ERROR: network error'); } }) }
      : real(sql));
  }

  const env = {
    DB_FILE_INDEX: fileIndex,
    DB_LOANS_EXPENSES: loansDb,
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
    R2_PUBLIC_BASE: R2_BASE,
    DRIVE_ROOT_FOLDER_ID: 'root-folder',
    DRIVE_OAUTH_CLIENT_ID: 'id',
    DRIVE_OAUTH_CLIENT_SECRET: 'secret-value',
    DRIVE_OAUTH_REFRESH_TOKEN: 'refresh-value',
    R2_FILES: {
      async get(key) {
        const o = objects.get(key);
        if (!o) return null;
        return {
          httpMetadata: { contentType: o.contentType },
          async arrayBuffer() { return new TextEncoder().encode(o.body).buffer; },
        };
      },
      async delete(key) { deleted.push(key); objects.delete(key); },
      async put() { return {}; },
      async list() { return { objects: [], truncated: false }; },
    },
    _state: { objects, deleted, permissionGrants, uploads },
  };

  globalThis.fetch = async (url, init = {}) => {
    const u = url.toString();
    // OAuth token mint
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'drive-token', expires_in: 3600 }), { status: 200 });
    }
    // Folder lookup / creation
    if (u.includes('/drive/v3/files?') && (init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), { status: 200 });
    }
    if (u.includes('/upload/drive/v3/files')) {
      uploads.push(u);
      return new Response(JSON.stringify({ id: `drive-${uploads.length}` }), { status: 200 });
    }
    if (/\/drive\/v3\/files\/[^/]+\/permissions/.test(u)) {
      permissionGrants.push(u.match(/files\/([^/]+)\/permissions/)[1]);
      return new Response(JSON.stringify({ id: 'perm-1' }), { status: 200 });
    }
    if (u.includes('/drive/v3/files')) {
      return new Response(JSON.stringify({ id: 'folder-1' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  return env;
}

const consentRow = (env) => env.DB_LOANS_EXPENSES
  .prepare('SELECT photo_url, signature_url FROM loan_consents WHERE consent_id = ?').bind('CN-1').first();
const pdfRow = (env) => env.DB_FILE_INDEX
  .prepare('SELECT public_link FROM generated_files WHERE record_id = ?').bind('receipt-2026-1').first('public_link');

// ================================================= 1. NOTHING IS DELETED EARLY

test('P0-06: a failed DB update keeps the R2 object (no dangling reference)', async () => {
  const env = makeEnv({ failDbUpdate: 'generated_files' });

  const res = await moveYearToDrive(env, 2026, SUPERADMIN);

  assert.ok(res.failed >= 1, 'the PDF is reported as failed');
  // On main the object is already gone here and the row still points at it.
  assert.ok(env._state.objects.has('2026/pdf/receipt/r1.pdf'), 'the source file must survive');
  assert.ok(!env._state.deleted.includes('2026/pdf/receipt/r1.pdf'), 'and must not have been deleted');
  assert.equal(await pdfRow(env), `${R2_BASE}/2026/pdf/receipt/r1.pdf`, 'the row still points at a file that EXISTS');
});

test('P0-06: a failed consent update keeps the photo and signature', async () => {
  const env = makeEnv({ failDbUpdate: 'loan_consents' });

  const res = await moveYearToDrive(env, 2026, SUPERADMIN);

  assert.ok(res.failed >= 2, 'both consent files are reported as failed');
  assert.ok(env._state.objects.has('2026/consent/photo1.jpg'), 'the consent photo survives');
  assert.ok(env._state.objects.has('2026/consent/sign1.jpg'), 'the signature survives');
  const row = await consentRow(env);
  assert.match(row.photo_url, /^https:\/\/files\.test\//, 'the row still points at the surviving object');
  assert.match(row.signature_url, /^https:\/\/files\.test\//);
});

test('P0-06: the R2 delete happens only AFTER the row is updated', async () => {
  const env = makeEnv();
  const order = [];
  const realDelete = env.R2_FILES.delete.bind(env.R2_FILES);
  env.R2_FILES.delete = async (key) => { order.push(`delete:${key}`); return realDelete(key); };
  const realPrepare = env.DB_FILE_INDEX.prepare.bind(env.DB_FILE_INDEX);
  env.DB_FILE_INDEX.prepare = (sql) => {
    if (/UPDATE generated_files/.test(sql)) order.push('update:generated_files');
    return realPrepare(sql);
  };

  await moveYearToDrive(env, 2026, SUPERADMIN);

  const updateAt = order.indexOf('update:generated_files');
  const deleteAt = order.indexOf('delete:2026/pdf/receipt/r1.pdf');
  assert.ok(updateAt >= 0 && deleteAt >= 0, 'both steps ran');
  assert.ok(updateAt < deleteAt, 'the database moved first, then the source was removed');
});

// ============================================ 2. CONSENT EVIDENCE STAYS PRIVATE

test('P0-06: consent photos and signatures are NOT made anonymously readable', async () => {
  const env = makeEnv();

  const res = await moveYearToDrive(env, 2026, SUPERADMIN);

  assert.equal(res.failed, 0, `no failures: ${JSON.stringify(res.errors)}`);
  assert.equal(res.moved, 3, 'one PDF + photo + signature');
  // Three Drive uploads happened, but only ONE permission grant — the PDF.
  assert.equal(env._state.uploads.length, 3);
  assert.equal(env._state.permissionGrants.length, 1,
    'on main this is 3: the photo and the signature were published too');
  assert.equal(env._state.permissionGrants[0], 'drive-1', 'the PDF is the one that is public');
});

test('P0-06: the archived rows point at the new Drive URLs', async () => {
  const env = makeEnv();

  await moveYearToDrive(env, 2026, SUPERADMIN);

  assert.match(await pdfRow(env), /drive\.google\.com\/uc\?export=download&id=drive-1/);
  const row = await consentRow(env);
  assert.match(row.photo_url, /lh3\.googleusercontent\.com\/d\/drive-/);
  assert.match(row.signature_url, /lh3\.googleusercontent\.com\/d\/drive-/);
});

test('P0-06: the sources are gone once every reference has moved', async () => {
  const env = makeEnv();

  await moveYearToDrive(env, 2026, SUPERADMIN);

  assert.deepEqual(env._state.deleted.sort(), [
    '2026/consent/photo1.jpg',
    '2026/consent/sign1.jpg',
    '2026/pdf/receipt/r1.pdf',
  ]);
});

// ==================================================== 3. GUARDS AND RE-RUNS

test('P0-06: re-running the archive is a no-op, not a re-upload', async () => {
  const env = makeEnv();
  await moveYearToDrive(env, 2026, SUPERADMIN);
  const uploadsAfterFirst = env._state.uploads.length;

  const second = await moveYearToDrive(env, 2026, SUPERADMIN);

  assert.equal(second.moved, 0);
  assert.equal(env._state.uploads.length, uploadsAfterFirst, 'nothing was uploaded again');
});

test('P0-06: a concurrent re-generation is not overwritten', async () => {
  const env = makeEnv();
  // Someone re-generates the PDF (new R2 link) between our read and our update.
  const realPrepare = env.DB_FILE_INDEX.prepare.bind(env.DB_FILE_INDEX);
  let fired = false;
  env.DB_FILE_INDEX.prepare = (sql) => {
    if (!fired && /UPDATE generated_files/.test(sql)) {
      fired = true;
      realPrepare("UPDATE generated_files SET public_link = 'https://files.test/2026/pdf/receipt/r1-v2.pdf' WHERE record_id = 'receipt-2026-1'")
        .bind().run();
    }
    return realPrepare(sql);
  };

  const res = await moveYearToDrive(env, 2026, SUPERADMIN);

  assert.ok(res.failed >= 1, 'the stale archive attempt is reported, not silently applied');
  assert.equal(await pdfRow(env), 'https://files.test/2026/pdf/receipt/r1-v2.pdf',
    "the newer link survives");
  assert.ok(!env._state.deleted.includes('2026/pdf/receipt/r1.pdf'),
    'and the old object is not deleted while something may still reference it');
});

test('P0-06: still Superadmin-only', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => moveYearToDrive(env, 2026, { name: 'USER0002', role: 'Admin' }),
    (err) => { assert.equal(err.permission, true); return true; }
  );
});
