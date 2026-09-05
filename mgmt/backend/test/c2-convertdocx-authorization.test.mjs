// ============ AUDIT C-2 — client-chosen authorization for PDF generation ============
//
// `mode` came straight from the request body and, inside convertDocxToPdf, it is
// the ONLY thing that selects the authorization branch. A Subadmin could send
// mode:'auto' + force:true + a recordId belonging to someone else's consent and
// overwrite the indexed PDF the public portal serves as a "Verified Record".
//
// These tests drive the REAL exported functions, so they cover both the
// per-endpoint gate and the defence-in-depth guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { convertDocxToPdf } from '../src/docxTemplates.js';
import { enqueueCollectionJob } from '../src/collectionQueue.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0002', role: 'Admin' };
const SUBADMIN = { name: 'USER0003', role: 'Subadmin' };

// A valid .docx base64 (ZIP magic "PK\x03\x04" -> "UEsDB..."), padded to a legal
// length so assertValidDocxBase64 accepts it.
const DOCX_B64 = 'UEsDBBQAAAAIAA' + 'A'.repeat(18);

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const misc = makeD1(schemaFor('misc.sql'));
  for (const name of ['USER0002', 'USER0003']) {
    core.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
      .bind(2026, name, 'Member').run();
  }
  return {
    DB_CORE: core,
    DB_MISC: misc,
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    // Deliberately absent: DRIVE_ROOT_FOLDER_ID. Every test here must be refused
    // BEFORE any Drive/R2 work is attempted, so reaching the Drive step at all is
    // itself a failure signal (it surfaces as a distinctive error message).
  };
}

const DRIVE_REACHED = /DRIVE_ROOT_FOLDER_ID not configured/;

// ------------------------------------------------------------------ THE EXPLOIT

test('C-2: a staff-level call cannot generate a consent document', async () => {
  const env = makeEnv();
  for (const actor of [SUBADMIN, ADMIN]) {
    for (const docType of ['consent_loaner', 'consent_guarantor']) {
      await assert.rejects(
        () => convertDocxToPdf(env, docType, 2026, `${docType}-2026-CN-victim`,
          DOCX_B64, 'x.docx', actor, 'single', { force: true }),
        (err) => {
          assert.equal(err.permission, true, 'must be a PermissionError (403)');
          assert.match(err.message, /Consent documents cannot be generated from this screen/);
          return true;
        },
        `${actor.role} + ${docType} must be refused`
      );
    }
  }
});

test('C-2: the old exploit shape (mode:"auto" + force) can no longer touch a consent', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => convertDocxToPdf(env, 'consent_loaner', 2026, 'consent_loaner-2026-CN-victim',
      DOCX_B64, 'x.docx', SUBADMIN, 'auto', { force: true }),
    /Consent documents cannot be generated from this screen/
  );
  // Nothing was written to the public file index.
  const { results } = await env.DB_FILE_INDEX.prepare('SELECT * FROM generated_files').all();
  assert.equal(results.length, 0, 'no generated_files row may have been created');
});

test('C-2: recordId must describe the document being written', async () => {
  const env = makeEnv();
  const cases = [
    ['receipt', 2026, 'consent_loaner-2026-CN1', 'a receipt call filing under a consent id'],
    ['receipt', 2026, 'certificate-2026-5', 'a receipt call filing under a certificate id'],
    ['receipt', 2026, 'receipt-2025-5', 'a 2026 call filing under 2025'],
    ['samaan', 2026, 'receipt-2026-5', 'a samaan call filing under a receipt id'],
    ['report_both', 2026, 'report_en-2026', 'a report_both call filing under report_en'],
    ['report_both', 2026, 'report_both-2027', 'a report call filing under the wrong year'],
  ];
  for (const [docType, year, recordId, why] of cases) {
    await assert.rejects(
      () => convertDocxToPdf(env, docType, year, recordId, DOCX_B64, 'x.docx', SUPERADMIN, 'bulk', {}),
      (err) => {
        assert.equal(err.expected, true, 'a user-facing ValidationError, not a 500');
        assert.match(err.message, /does not match/);
        return true;
      },
      why
    );
  }
});

// REGRESSION: the yearly reports use a PER-YEAR recordId `<docType>-<year>` with
// no trailing `-<ref>` (PdfExport.jsx builds `${docType}-${year}`). The first
// version of assertRecordIdMatches required a trailing `-`, so it rejected every
// report with "does not match report_both 2026" and broke PDF Export entirely.
test('C-2: a per-year report recordId (no trailing -ref) is accepted', async () => {
  const env = makeEnv();
  for (const dt of ['report_en', 'report_hi', 'report_both']) {
    // Reaches past the recordId check (it fails LATER, on the missing Drive
    // config / template), which proves the recordId itself was accepted. A
    // "does not match" rejection here would be the regression.
    await assert.rejects(
      () => convertDocxToPdf(env, dt, 2026, `${dt}-2026`, DOCX_B64, 'x.docx', SUPERADMIN, 'bulk', {}),
      (err) => {
        assert.doesNotMatch(err.message, /does not match/,
          `${dt}-2026 must not be rejected as a mismatched reference`);
        return true;
      }
    );
  }
});

test('C-2: an unknown mode still falls back to the MOST restrictive branch', async () => {
  const env = makeEnv();
  for (const mode of ['', null, undefined, 'god', 'BULK', 'public ']) {
    await assert.rejects(
      () => convertDocxToPdf(env, 'receipt', 2026, 'receipt-2026-1', DOCX_B64, 'x.docx', SUBADMIN, mode, {}),
      /Only a Superadmin can perform this action/,
      `mode=${JSON.stringify(mode)} must degrade to Superadmin-only`
    );
  }
});

// ------------------------------------------------- THE FIX DID NOT BREAK THINGS

test('C-2 regression guard: staff can still generate their own receipt/certificate/samaan', async () => {
  const env = makeEnv();
  for (const actor of [SUBADMIN, ADMIN, SUPERADMIN]) {
    for (const docType of ['receipt', 'certificate', 'samaan']) {
      // Passes every authorization + recordId check and only then fails on the
      // deliberately-missing Drive config — i.e. it got all the way through.
      await assert.rejects(
        () => convertDocxToPdf(env, docType, 2026, `${docType}-2026-42`, DOCX_B64, 'x.docx', actor, 'single', {}),
        DRIVE_REACHED,
        `${actor.role} must still be allowed to generate a ${docType}`
      );
    }
  }
});

test('C-2 regression guard: a Superadmin bulk run can still generate consent documents', async () => {
  const env = makeEnv();
  for (const docType of ['consent_loaner', 'consent_guarantor']) {
    await assert.rejects(
      () => convertDocxToPdf(env, docType, 2026, `${docType}-2026-CN1`, DOCX_B64, 'x.docx', SUPERADMIN, 'bulk', { force: true }),
      DRIVE_REACHED,
      'Generate PDFs must still cover consents for a Superadmin'
    );
  }
});

test('C-2 regression guard: the token-gated public consent path still works (user=null)', async () => {
  const env = makeEnv();
  // convertDocxToPdfPublic derives everything from the verified consent row and
  // calls through with user=null + mode 'public'.
  await assert.rejects(
    () => convertDocxToPdf(env, 'consent_loaner', 2026, 'consent_loaner-2026-CN1', DOCX_B64, 'Consent-CN1.docx', null, 'public', { force: true }),
    DRIVE_REACHED,
    'the public consent download must still reach the generator'
  );
});

// ----------------------------------------------------------------- QUEUE PATH

test('C-2: the queue refuses document types a collection save cannot produce', async () => {
  const env = makeEnv();
  for (const docType of ['consent_loaner', 'consent_guarantor', 'report_en', 'report_hi', 'report_both', 'nonsense']) {
    await assert.rejects(
      () => enqueueCollectionJob(env, {
        docType, year: 2026, rowIndex: 1, recordId: `${docType}-2026-CN-victim`,
        payload: { Year: 2026 }, filledBase64: DOCX_B64, fileName: 'x.docx',
      }, SUBADMIN),
      /cannot be queued from a collection save/,
      `${docType} must not be queueable`
    );
  }
  const { results } = await env.DB_MISC.prepare('SELECT * FROM collection_jobs').all();
  assert.equal(results.length, 0, 'no job row may have been created');
});

test('C-2: the queue refuses a recordId that does not match its docType', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => enqueueCollectionJob(env, {
      docType: 'receipt', year: 2026, rowIndex: 1, recordId: 'consent_loaner-2026-CN1',
      payload: { Year: 2026 }, filledBase64: DOCX_B64,
    }, SUBADMIN),
    /does not match its document type/
  );
  // …and a recordId with no docType at all.
  await assert.rejects(
    () => enqueueCollectionJob(env, {
      docType: '', year: 2026, rowIndex: 1, recordId: 'receipt-2026-1',
      payload: { Year: 2026 },
    }, SUBADMIN),
    /without a document type/
  );
});

test('C-2: the queue rejects an oversized payload instead of failing the D1 insert', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => enqueueCollectionJob(env, {
      docType: 'receipt', year: 2026, rowIndex: 1, recordId: 'receipt-2026-1',
      payload: { Year: 2026 }, filledBase64: 'A'.repeat(900 * 1024),
    }, SUBADMIN),
    (err) => {
      assert.equal(err.expected, true);
      assert.match(err.message, /too large to queue/);
      return true;
    }
  );
});

test('C-2 regression guard: a normal collection job still enqueues', async () => {
  const env = makeEnv();
  for (const docType of ['receipt', 'certificate', 'samaan']) {
    const res = await enqueueCollectionJob(env, {
      docType, year: 2026, rowIndex: 7, recordId: `${docType}-2026-7`,
      isNewEntry: true, payload: { Year: 2026, Name: 'USER0009', Amount: 100 },
      filledBase64: DOCX_B64, fileName: `${docType}.docx`,
    }, SUBADMIN);
    assert.equal(res.success, true);
    assert.match(res.jobId, /^JOB/);
  }
  // …and the resell case: no document at all, WhatsApp only.
  const resell = await enqueueCollectionJob(env, {
    docType: '', year: 2026, rowIndex: 8, recordId: '',
    isNewEntry: true, payload: { Year: 2026, 'Is Resell': 'TRUE' },
    filledBase64: '', fileName: '',
  }, SUBADMIN);
  assert.equal(resell.success, true);

  const { results } = await env.DB_MISC.prepare("SELECT doc_type, status FROM collection_jobs ORDER BY id").all();
  assert.deepEqual(results.map(r => r.doc_type), ['receipt', 'certificate', 'samaan', '']);
  assert.ok(results.every(r => r.status === 'pending'));
});

test('C-2: the queue still enforces the year lock and year access first', async () => {
  const env = makeEnv();
  env.DB_CORE.prepare('INSERT INTO locked_years (year, lockedby, lockedat) VALUES (?,?,?)')
    .bind(2026, 'USER0001', '2026-01-01').run();
  await assert.rejects(
    () => enqueueCollectionJob(env, {
      docType: 'receipt', year: 2026, rowIndex: 1, recordId: 'receipt-2026-1',
      payload: { Year: 2026 }, filledBase64: DOCX_B64,
    }, SUBADMIN),
    /year is locked/
  );
});
