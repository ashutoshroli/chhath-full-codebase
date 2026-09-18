// ====== THE BULK REPORT DISPATCH MUST FORWARD THE ARRAYS INTACT (blank report) ======
//
// This is the behavioral half of the blank-Annual-Report fix. The source-level
// contract lives in pdf-export-bulk-data-wiring.test.mjs; here we drive the REAL
// docx.dispatchBulkPdfConvert end to end, intercept the outbound Render 'pdf_convert'
// job, and assert its `data` still carries the NON-EMPTY contributors/expenses/
// loans/guarantors arrays and the summary scalars that PdfExport.jsx builds — not a
// flattened, stringified, or {} payload.
//
// This is the assertion that would have caught the bug: on `main`, the handler
// forwarded req.base64 (undefined) into dispatchBulkPdfConvert's `data` parameter, so
// the job body's `data` was {} and Render rendered every loop's empty-state fallback.
// Calling dispatchBulkPdfConvert directly with the real placeholder object and reading
// the job body proves the arrays survive the dispatch untouched.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { dispatchBulkPdfConvert } from '../src/docxTemplates.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

// A valid .docx base64 (ZIP magic "PK\x03\x04" -> "UEsDB..."), long enough to look
// like a real template. It only has to travel through the dispatch; nothing renders
// it in this test.
const TEMPLATE_B64 = 'UEsDBBQAAAAIAA' + 'A'.repeat(64);
const DRIVE_FILE_ID = 'drive-tpl-report_en-2026';
const TEMPLATE_UPDATED_AT = '2026-01-01T00:00:00.000Z';

// Build an env where getDocxTemplate() resolves WITHOUT touching Drive: it reads the
// docx_templates row for the drive_file_id + updated_at, then reads the template bytes
// from KV under `docxtpl:<drive_file_id>:<updated_at>`. Pre-seeding that key returns the
// bytes from cache, so no Google Drive call is made.
function makeEnv() {
  const templates = makeD1(schemaFor('templates.sql'));
  templates.prepare(
    'INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  ).bind('report_en', 2026, DRIVE_FILE_ID, 'report.docx', TEMPLATE_UPDATED_AT, TEMPLATE_UPDATED_AT).run();

  const kv = makeKV();
  kv.put(`docxtpl:${DRIVE_FILE_ID}:${TEMPLATE_UPDATED_AT}`, TEMPLATE_B64);

  return {
    DB_TEMPLATES: templates,
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: kv,
    DRIVE_ROOT_FOLDER_ID: 'drive-root',
    RENDER_SERVICE_URL: 'https://render.example.test',
    RENDER_API_KEY: 'render-api-key-abc',
    RENDER_WEBHOOK_SECRET: 'render-webhook-secret-xyz',
  };
}

// Stub the Worker->Render POST and capture every job body sent to <url>/jobs.
function stubRenderFetch() {
  const jobs = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    let body = null;
    try { body = JSON.parse(opts && opts.body); } catch (e) { body = null; }
    jobs.push({ url, body });
    return { ok: true, status: 202, json: async () => ({ renderJobId: 'render-abc' }) };
  };
  return { jobs, restore: () => { globalThis.fetch = orig; } };
}

// The placeholder set mirrors what PdfExport.jsx builds: scalars + nested arrays
// contributors/expenses/loans/guarantors, each row carrying named fields.
function reportPlaceholders() {
  return {
    YEAR: 2026,
    TOTAL_COLLECTION: '\u20b9 1,50,000',
    PAST_RETURN: '\u20b9 10,000',
    TOTAL_EXPENSES: '\u20b9 90,000',
    TOTAL_BUDGET: '\u20b9 1,60,000',
    SURPLUS: '\u20b9 70,000',
    GENERATED_AT: '01/01/2026, 10:00:00 am',
    contributors: [
      { SL_NO: 1, NAME: 'Aarav', NAME_HI: '', FATHER_NAME: 'Ramesh', VILLAGE: 'Sonpur', VILLAGE_HI: '', AMOUNT: '\u20b9 500' },
      { SL_NO: 2, NAME: 'Bhavya', NAME_HI: '', FATHER_NAME: 'Suresh', VILLAGE: 'Hajipur', VILLAGE_HI: '', AMOUNT: '\u20b9 1,000' },
      { SL_NO: 3, NAME: 'Chandan', NAME_HI: '', FATHER_NAME: 'Mahesh', VILLAGE: 'Chhapra', VILLAGE_HI: '', AMOUNT: '\u20b9 250' },
    ],
    expenses: [
      { SL_NO: 1, DETAIL: 'Tent', AMOUNT: '\u20b9 30,000' },
      { SL_NO: 2, DETAIL: 'Prasad', AMOUNT: '\u20b9 60,000' },
    ],
    loans: [
      { SL_NO: 1, NAME: 'Deepak', AMOUNT: '\u20b9 20,000' },
    ],
    guarantors: [
      { GUARANTOR_NAME: 'Eshan', GUARANTOR_NAME_HI: '' },
      { GUARANTOR_NAME: 'Farhan', GUARANTOR_NAME_HI: '' },
    ],
  };
}

describe('dispatchBulkPdfConvert forwards the report arrays to Render intact', () => {
  test('the outbound pdf_convert job body carries `data` with the full arrays + scalars', async () => {
    const env = makeEnv();
    const { jobs, restore } = stubRenderFetch();
    try {
      const placeholders = reportPlaceholders();
      const res = await dispatchBulkPdfConvert(
        env, 'report_en', 2026, 'report_en-2026', placeholders, 'report.docx',
        SUPERADMIN, { force: true },
      );
      assert.equal(res.dispatched, true, 'the job must have been dispatched to Render');

      assert.equal(jobs.length, 1, 'exactly one Render job POST');
      const job = jobs[0];
      assert.match(job.url, /\/jobs$/);
      assert.equal(job.body.kind, 'pdf_convert');
      const data = job.body.payload && job.body.payload.data;
      assert.ok(data && typeof data === 'object', 'the job payload must carry a `data` object');

      // The exact failure on `main`: data was {} (from the undefined req.base64).
      assert.ok(Object.keys(data).length > 0, 'data must not be empty — that was the blank-report bug');

      // Scalars survive verbatim.
      assert.equal(data.YEAR, 2026);
      assert.equal(data.TOTAL_COLLECTION, placeholders.TOTAL_COLLECTION);
      assert.equal(data.TOTAL_EXPENSES, placeholders.TOTAL_EXPENSES);
      assert.equal(data.SURPLUS, placeholders.SURPLUS);

      // Every array is present, still an ARRAY, and the same length — not flattened,
      // dropped, or stringified.
      for (const key of ['contributors', 'expenses', 'loans', 'guarantors']) {
        assert.ok(Array.isArray(data[key]), `${key} must arrive as an array`);
        assert.equal(data[key].length, placeholders[key].length,
          `${key} must keep all ${placeholders[key].length} rows`);
      }

      // Nested field NAMES and values are preserved inside the rows.
      assert.equal(data.contributors[0].NAME, 'Aarav');
      assert.equal(data.contributors[2].VILLAGE, 'Chhapra');
      assert.equal(data.contributors[1].AMOUNT, '\u20b9 1,000');
      assert.equal(data.expenses[0].DETAIL, 'Tent');
      assert.equal(data.loans[0].NAME, 'Deepak');
      assert.equal(data.guarantors[1].GUARANTOR_NAME, 'Farhan');

      // The whole object round-trips unchanged (deep-equal against what was passed in).
      assert.deepEqual(data, placeholders,
        'the placeholder set must reach Render byte-for-byte, not partially');
    } finally { restore(); }
  });

  test('an empty placeholder set would send empty arrays — the shape the bug produced', async () => {
    // A control that pins the OBSERVED symptom: when `data` is {} the job body has no
    // arrays, which is exactly what Render turned into every empty-state fallback. This
    // is what the handler used to send (req.base64 === undefined -> data:{}).
    const env = makeEnv();
    const { jobs, restore } = stubRenderFetch();
    try {
      await dispatchBulkPdfConvert(env, 'report_en', 2026, 'report_en-2026', {}, 'report.docx', SUPERADMIN, { force: true });
      const data = jobs[0].body.payload.data;
      assert.deepEqual(data, {}, 'an empty placeholder set reaches Render as {} — the blank report');
      assert.equal(data.contributors, undefined, 'no contributors array -> Render renders "No contributors."');
    } finally { restore(); }
  });
});
