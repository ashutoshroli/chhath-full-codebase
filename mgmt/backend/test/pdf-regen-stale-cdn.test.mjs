// ====== REGENERATION WRITES A NEW URL AND DELETES THE OLD R2 OBJECT ======
//
// The behavioral half of the stale-CDN fix. Driving applyPdfConvertResult (the
// Render single-callback side-effect that ALL of reports/receipts/certificates/
// samaan/consent/auto-generate flow through via applyDocxRenderResult) TWICE for
// the SAME record must:
//   (1) write a NEW distinct URL into generated_files.public_link AND drive_path
//       on the second generation (the recordGeneratedFile UPSERT), and
//   (2) best-effort DELETE the previous R2 object (its key differs from the new
//       one), so distinct keys do not orphan-leak R2 storage.
//
// And a legacy Drive-hosted public_link must NEVER be passed to deleteFromR2
// (isR2Url guard), so migrating from Drive to R2 does not attempt a bogus delete.
//
// On current main this would fail: the key was timestamp-free, so both
// generations produced the SAME key/URL and nothing was ever deleted.
//
// Run: node --test mgmt/backend/test/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeR2, schemaFor } from './helpers/stubs.mjs';
import { applyPdfConvertResult, isFileGenerated } from '../src/docxTemplates.js';
import { isR2Url, keyFromR2Url } from '../src/r2.js';

const R2_BASE = 'https://files.example.test';

function makeEnv() {
  const r2 = makeR2();
  return {
    env: {
      R2_FILES: r2,
      R2_PUBLIC_BASE: R2_BASE,
      DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
      DB_LOGS: makeD1(schemaFor('logs.sql')),
    },
    r2,
  };
}

// A tiny but valid base64 PDF payload; nothing renders it here.
const pdfBase64 = Buffer.from('%PDF-1.4 hello world').toString('base64');

describe('regeneration produces a new URL and deletes the previous R2 object', () => {
  test('two generations of the same report write different URLs and delete the old key', async () => {
    const { env, r2 } = makeEnv();
    const payload = { docType: 'report_en', year: 2026, recordId: 'report_en-2026' };

    // First generation.
    const first = await applyPdfConvertResult(env, payload, { pdfBase64, fileName: 'Chhath-Puja-Report-2026.pdf' });
    assert.ok(first && first.publicLink, 'first generation returns a public link');
    const row1 = await isFileGenerated(env, 'report_en', 2026, 'report_en-2026');
    assert.equal(row1.public_link, first.publicLink, 'index row points at the first URL');
    assert.equal(row1.drive_path, keyFromR2Url(env, first.publicLink), 'drive_path is the first R2 key');
    assert.equal(r2._deletes().length, 0, 'nothing to delete on the very first generation');

    // Force a later timestamp so the second key cannot collide within the same ms.
    await new Promise(r => setTimeout(r, 3));

    // Second generation (regeneration of the SAME record).
    const second = await applyPdfConvertResult(env, payload, { pdfBase64, fileName: 'Chhath-Puja-Report-2026.pdf' });
    assert.ok(second && second.publicLink, 'second generation returns a public link');

    assert.notEqual(second.publicLink, first.publicLink,
      'regeneration must yield a DIFFERENT URL (no in-place overwrite that a CDN could serve stale)');

    // The index row is rewritten to the NEW URL/key on BOTH columns.
    const row2 = await isFileGenerated(env, 'report_en', 2026, 'report_en-2026');
    assert.equal(row2.public_link, second.publicLink, 'public_link rewritten to the new URL');
    assert.equal(row2.drive_path, keyFromR2Url(env, second.publicLink), 'drive_path rewritten to the new key');

    // The PREVIOUS R2 object is deleted best-effort.
    const oldKey = keyFromR2Url(env, first.publicLink);
    assert.ok(r2._deletes().includes(oldKey), `the old R2 key ${oldKey} must be deleted`);
    // The NEW object is not deleted.
    assert.ok(!r2._deletes().includes(keyFromR2Url(env, second.publicLink)), 'the new object must NOT be deleted');

    // Both live under the same 2026/pdf/report_en/ prefix.
    assert.match(oldKey, /^2026\/pdf\/report_en\//);
    assert.match(keyFromR2Url(env, second.publicLink), /^2026\/pdf\/report_en\//);
  });

  test('a legacy Drive-hosted public_link is NEVER passed to deleteFromR2', async () => {
    const { env, r2 } = makeEnv();
    const docType = 'receipt', year = 2026, recordId = 'RCPT-2026-1';

    // Seed an EXISTING row whose public_link is a Google Drive URL (pre-R2 migration).
    const driveLink = 'https://drive.google.com/uc?export=download&id=drive-abc-123';
    assert.equal(isR2Url(env, driveLink), false, 'sanity: the Drive link is not an R2 URL');
    await env.DB_FILE_INDEX.prepare(
      `INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link, drive_path, generated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(docType, year, recordId, 'old.pdf', driveLink, 'Generated PDFs/Receipts/2026/old.pdf', '2026-01-01T00:00:00.000Z').run();

    // Regenerate -> writes a new R2 object, but must not attempt to delete the Drive file.
    const res = await applyPdfConvertResult(env, { docType, year, recordId }, { pdfBase64, fileName: 'new.pdf' });
    assert.ok(res && res.publicLink && isR2Url(env, res.publicLink), 'new object is an R2 URL');

    assert.equal(r2._deletes().length, 0, 'a Drive-hosted legacy link must never be deleted from R2');
    const row = await isFileGenerated(env, docType, year, recordId);
    assert.equal(row.public_link, res.publicLink, 'row now points at the new R2 URL');
  });
});
